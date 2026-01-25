let activeSocket = null;

export const setActiveSocket = (socket) => {
  activeSocket = socket;
};

export const getActiveSocket = () => activeSocket;
