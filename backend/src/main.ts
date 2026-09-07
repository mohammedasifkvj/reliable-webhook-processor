import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the exact bytes PayPal signed available on
  // req.rawBody, which the CRC32 check in paypal-signature.ts needs.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
}
bootstrap();
