// Mock do otplib para testes unitários — o MfaService é mockado via useValue no TestingModule.
export const generateSecret = jest.fn().mockReturnValue('BASE32SECRET');
export const generateURI = jest.fn().mockReturnValue('otpauth://totp/test');
export const verify = jest.fn().mockResolvedValue({ valid: true });
export const generateSync = jest.fn().mockReturnValue('123456');
export const verifySync = jest.fn().mockReturnValue({ valid: true });
