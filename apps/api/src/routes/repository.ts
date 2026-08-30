import { Router } from 'express';
import { prisma } from '../prisma';
import { Prisma, RepositoryProvider } from '../generated/prisma/client';
import { badRequest, conflict, notFound, wrap } from '../errors';
import { requireString } from '../validate';
import { parseGithubRepositoryUrl } from '../github/utils/repository-parser';
import { encryptToken, decryptToken } from '../github/utils/github-token-crypto';
import * as github from '../github/github.service';

export const repositoryRouter = Router();

const REPOSITORY_SELECT = {
  id: true,
  projectId: true,
  provider: true,
  owner: true,
  name: true,
  repositoryUrl: true,
  defaultBranch: true,
  connectedAt: true,
  lastValidatedAt: true,
  lastSyncedAt: true,
} satisfies Prisma.RepositorySelect;

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function findProjectOrThrow(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project not found');
  return project;
}

async function findRepositoryOrThrow(projectId: string) {
  const repository = await prisma.repository.findUnique({ where: { projectId } });
  if (!repository) throw notFound('No repository connected for this project');
  return repository;
}

repositoryRouter.post(
  '/projects/:projectId/repository',
  wrap(async (req, res) => {
    const { projectId } = req.params;
    await findProjectOrThrow(projectId);

    const repositoryUrl = requireString(req.body, 'repositoryUrl');
    const accessToken = requireString(req.body, 'accessToken');

    let parsed;
    try {
      parsed = parseGithubRepositoryUrl(repositoryUrl);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid repository URL');
    }

    let metadata;
    try {
      metadata = await github.getRepository(accessToken, parsed.owner, parsed.name);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Unable to access repository');
    }

    const encryptedAccessToken = encryptToken(accessToken);
    const normalizedUrl = `https://github.com/${metadata.owner}/${metadata.name}`;

    try {
      const repository = await prisma.repository.create({
        data: {
          projectId,
          provider: RepositoryProvider.GITHUB,
          owner: metadata.owner,
          name: metadata.name,
          repositoryUrl: normalizedUrl,
          defaultBranch: metadata.defaultBranch,
          encryptedAccessToken,
          lastValidatedAt: new Date(),
        },
        select: REPOSITORY_SELECT,
      });
      res.status(201).json(repository);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflict('This project already has a connected repository, or this repository is already connected elsewhere');
      }
      throw err;
    }
  }),
);

repositoryRouter.get(
  '/projects/:projectId/repository',
  wrap(async (req, res) => {
    await findProjectOrThrow(req.params.projectId);
    await findRepositoryOrThrow(req.params.projectId);
    res.json(
      await prisma.repository.findUnique({ where: { projectId: req.params.projectId }, select: REPOSITORY_SELECT }),
    );
  }),
);

repositoryRouter.delete(
  '/projects/:projectId/repository',
  wrap(async (req, res) => {
    await findProjectOrThrow(req.params.projectId);
    const repository = await findRepositoryOrThrow(req.params.projectId);
    await prisma.repository.delete({ where: { id: repository.id } });
    res.status(204).send();
  }),
);

repositoryRouter.post(
  '/projects/:projectId/repository/sync',
  wrap(async (req, res) => {
    await findProjectOrThrow(req.params.projectId);
    const repository = await findRepositoryOrThrow(req.params.projectId);

    const accessToken = decryptToken(repository.encryptedAccessToken);

    let tree;
    try {
      tree = await github.getDirectoryTree(accessToken, repository.owner, repository.name, repository.defaultBranch);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Unable to sync repository');
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.repositoryFile.deleteMany({ where: { repositoryId: repository.id } }),
      prisma.repositoryFile.createMany({
        data: tree.map((entry) => ({
          repositoryId: repository.id,
          path: entry.path,
          type: entry.type,
          sha: entry.sha,
          lastSyncedAt: now,
        })),
      }),
      prisma.repository.update({ where: { id: repository.id }, data: { lastSyncedAt: now, lastValidatedAt: now } }),
    ]);

    res.json({ success: true, fileCount: tree.length, lastSyncedAt: now });
  }),
);
