import { Router } from 'express';
import { prisma } from '../prisma';
import { Prisma } from '../generated/prisma/client';
import { conflict, notFound, wrap } from '../errors';
import { optionalString, requireSlug, requireString } from '../validate';

export const projectsRouter = Router();

async function findProjectOrThrow(id: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw notFound('Project not found');
  return project;
}

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

projectsRouter.post(
  '/projects',
  wrap(async (req, res) => {
    const name = requireString(req.body, 'name');
    const slug = requireSlug(req.body);
    const description = optionalString(req.body, 'description');

    try {
      const project = await prisma.project.create({ data: { name, slug, description } });
      res.status(201).json(project);
    } catch (err) {
      if (isUniqueConstraintError(err)) throw conflict('Project slug already exists');
      throw err;
    }
  }),
);

projectsRouter.get(
  '/projects',
  wrap(async (_req, res) => {
    const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(projects);
  }),
);

projectsRouter.get(
  '/projects/:projectId',
  wrap(async (req, res) => {
    res.json(await findProjectOrThrow(req.params.projectId));
  }),
);

projectsRouter.patch(
  '/projects/:projectId',
  wrap(async (req, res) => {
    await findProjectOrThrow(req.params.projectId);

    const data: { name?: string; slug?: string; description?: string } = {};
    if (req.body?.name !== undefined) data.name = requireString(req.body, 'name');
    if (req.body?.slug !== undefined) data.slug = requireSlug(req.body);
    if (req.body?.description !== undefined) data.description = optionalString(req.body, 'description');

    try {
      const project = await prisma.project.update({
        where: { id: req.params.projectId },
        data,
      });
      res.json(project);
    } catch (err) {
      if (isUniqueConstraintError(err)) throw conflict('Project slug already exists');
      throw err;
    }
  }),
);

projectsRouter.delete(
  '/projects/:projectId',
  wrap(async (req, res) => {
    await findProjectOrThrow(req.params.projectId);
    await prisma.project.delete({ where: { id: req.params.projectId } });
    res.status(204).send();
  }),
);
