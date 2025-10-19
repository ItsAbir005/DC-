// client/electron/preload.js
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  test: () => console.log('Electron API working!')
});
