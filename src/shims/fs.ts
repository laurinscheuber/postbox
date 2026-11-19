export const promises = {
  open: async (): Promise<never> => {
    throw new Error('Node fs is disabled in browser builds');
  },
};

const fsStub = {
  promises,
};

export default fsStub;
