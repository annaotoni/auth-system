// Mock do qrcode para testes unitários.
export const toDataURL = jest
  .fn()
  .mockResolvedValue('data:image/png;base64,mock');
