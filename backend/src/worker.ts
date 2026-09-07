import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerService } from './events/worker.service';

async function bootstrap() {
  // createApplicationContext gives the worker the same DI container (and
  // therefore the same DB pool + business logic) as the API, without
  // starting an HTTP listener. One codebase, two entrypoints.
  const app = await NestFactory.createApplicationContext(AppModule);
  const worker = app.get(WorkerService);
  const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  // eslint-disable-next-line no-console
  console.log(`[${workerId}] starting poll loop`);
  await worker.runForever(workerId);
}
bootstrap();
