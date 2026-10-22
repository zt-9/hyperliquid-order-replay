import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({define:{'import.meta.env.VITE_HOSTED':JSON.stringify(mode==='hosted'?'true':'false')},plugins:[react()],server:{proxy:{'/api':'http://127.0.0.1:3001'}}}));
