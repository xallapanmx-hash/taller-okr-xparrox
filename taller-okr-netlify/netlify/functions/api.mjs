// Función de Netlify: atiende todas las peticiones de la app en /api
import { getStore } from '@netlify/blobs';
import { handle } from '../lib/core.mjs';

export default async (req) => handle(req, getStore({ name: 'taller-okr', consistency: 'strong' }), process.env);

export const config = { path: '/api' };
