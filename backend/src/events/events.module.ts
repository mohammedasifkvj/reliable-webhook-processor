import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { WorkerService } from './worker.service';

@Module({
  controllers: [EventsController],
  providers: [EventsService, WorkerService],
  exports: [WorkerService],
})
export class EventsModule {}
