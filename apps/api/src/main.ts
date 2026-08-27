import 'dotenv/config';
import { app } from './app';
import { prisma } from './prisma';

const port = process.env.API_PORT ?? 3001;

async function bootstrap() {
  await prisma.$connect();

  const server = app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
