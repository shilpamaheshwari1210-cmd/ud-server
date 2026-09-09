import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../../../middlewares/auth.middleware';
import { validate } from '../../../middlewares/validate.middleware';
import {
  loginSchema, googleAuthSchema,
  forgotPasswordSchema, resetPasswordSchema, changePasswordSchema,
  refreshTokenSchema, requestOtpSchema, verifyOtpSchema,
} from '../validators/auth.validators';

const router = Router();

// Passwordless: one endpoint to ask for a code, one to spend it. The second
// creates the account when the address is new, so there is no separate
// registration call and no half-made account when someone walks away.
router.post('/otp/request', validate(requestOtpSchema), authController.requestOtp.bind(authController));
router.post('/otp/verify', validate(verifyOtpSchema), authController.verifyOtp.bind(authController));

// Password sign-in stays for accounts that have one. The only admin is
// admin@uniquedressup.com and the domain has no MX records, so a code sent
// there would bounce — removing this would lock the shop out of its own panel.
router.post('/login', validate(loginSchema), authController.login.bind(authController));
router.post('/google', validate(googleAuthSchema), authController.googleAuth.bind(authController));
router.post('/refresh', validate(refreshTokenSchema), authController.refresh.bind(authController));
router.post('/logout', authenticate, authController.logout.bind(authController));
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword.bind(authController));
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword.bind(authController));
router.put('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword.bind(authController));
router.get('/me', authenticate, authController.me.bind(authController));

export default router;
