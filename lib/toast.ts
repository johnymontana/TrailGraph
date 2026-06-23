'use client';
import { toaster } from '../components/ui/toaster';

/** Typed convenience wrappers over the app Toaster (components/ui/toaster.tsx). Client-only. */
export const toast = {
  success(title: string, description?: string) {
    toaster.create({ title, description, type: 'success', closable: true });
  },
  error(title: string, description?: string) {
    toaster.create({ title, description, type: 'error', closable: true });
  },
  info(title: string, description?: string) {
    toaster.create({ title, description, type: 'info', closable: true });
  },
};
