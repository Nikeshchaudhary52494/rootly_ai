import { Router } from 'express';
import { prisma } from '../prisma';
import { Prisma } from '../generated/prisma/client';
import { conflict, notFound, wrap } from '../errors';
import { requireEnvironmentType, requireSlug, requireString } from '../validate';

export const environmentsRouter = Router();

async function findProjectOrThrow(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project not found');
  return project;
}

async function findEnvironmentOrThrow(projectId: string, environmentId: string) {
  const environment = await prisma.environment.findFirst({
    where: { id: environmentId, projectId },
  });
  if (!environment) throw notFound('Environment not found');
  return environment;
}

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

environmentsRouter.post(
  '/projects/:projectId/environments',
  wrap(async (req, res) => {
    const { projectId } = req.params;
    await findProjectOrThrow(projectId);

    const name = requireString(req.body, 'name');
    const slug = requireSlug(req.body);
    const type = requireEnvironmentType(req.body);

    try {
      const environment = await prisma.environment.create({
        data: { name, slug, type, projectId },
      });
      res.status(201).json(environment);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflict('Environment slug already exists for this project');
      }
      throw err;
    }
  }),
);

environmentsRouter.get(
  '/projects/:projectId/environments',
  wrap(async (req, res) => {
    const { projectId } = req.params;
    await findProjectOrThrow(projectId);
    const environments = await prisma.environment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(environments);
  }),
);

environmentsRouter.get(
  '/projects/:projectId/environments/:environmentId',
  wrap(async (req, res) => {
    const { projectId, environmentId } = req.params;
    res.json(await findEnvironmentOrThrow(projectId, environmentId));
  }),
);

environmentsRouter.patch(
  '/projects/:projectId/environments/:environmentId',
  wrap(async (req, res) => {
    const { projectId, environmentId } = req.params;
    await findEnvironmentOrThrow(projectId, environmentId);

    const data: { name?: string; slug?: string; type?: ReturnType<typeof requireEnvironmentType> } = {};
    if (req.body?.name !== undefined) data.name = requireString(req.body, 'name');
    if (req.body?.slug !== undefined) data.slug = requireSlug(req.body);
    if (req.body?.type !== undefined) data.type = requireEnvironmentType(req.body);

    try {
      const environment = await prisma.environment.update({
        where: { id: environmentId },
        data,
      });
      res.json(environment);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflict('Environment slug already exists for this project');
      }
      throw err;
    }
  }),
);

environmentsRouter.delete(
  '/projects/:projectId/environments/:environmentId',
  wrap(async (req, res) => {
    const { projectId, environmentId } = req.params;
    await findEnvironmentOrThrow(projectId, environmentId);
    await prisma.environment.delete({ where: { id: environmentId } });
    res.status(204).send();
  }),
);
