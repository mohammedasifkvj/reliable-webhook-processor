import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyPayPalSignature } from './paypal-signature';


@Injectable()
export class PayPalSignatureGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers['paypal-transmission-sig']) {
      return true;
    }
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      throw new UnauthorizedException('PAYPAL_WEBHOOK_ID not configured');
    }
    // Verify PayPal signature
    const valid = await verifyPayPalSignature(req.rawBody, req.headers, webhookId);
    if (!valid) {
      throw new UnauthorizedException('Invalid PayPal webhook signature');
    }
    console.log('Paypal webhook signature is verified successfully');
    return true;
  }
}
