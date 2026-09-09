import Joi from 'joi';

export const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

export const googleAuthSchema = Joi.object({
  token: Joi.string().required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).max(100).required(),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).max(100).required(),
});

export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});



export const requestOtpSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),
  // Only needed the first time an address is seen; the service decides.
  firstName: Joi.string().trim().min(2).max(50).optional().allow(''),
  lastName: Joi.string().trim().max(50).optional().allow(''),
  phone: Joi.string().trim().pattern(/^[6-9]\d{9}$/).optional().allow('').messages({
    'string.pattern.base': 'Enter a valid 10-digit mobile number',
  }),
});

export const verifyOtpSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),
  otp: Joi.string().trim().pattern(/^\d{6}$/).required().messages({
    'string.pattern.base': 'Enter the 6-digit code from your email',
  }),
});
