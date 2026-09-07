import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { PayPalSignatureGuard } from '../paypal/paypal-signature.guard';

@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('webhooks')
  @UseGuards(PayPalSignatureGuard)
  async receive(@Body() body: any) {
    return this.events.ingest({
      eventId: body.eventId,
      type: body.type,
      data: body.data ?? {},
    });
  }

  @Get('events')
  async list() {
    return this.events.listEvents();
  }

  @Get('events/:eventId')
  async detail(@Param('eventId') eventId: string) {
    return this.events.getEventDetail(eventId);
  }

  @Post('events/:eventId/retry')
  async retry(@Param('eventId') eventId: string) {
    return this.events.manualRetry(eventId);
  }
}
