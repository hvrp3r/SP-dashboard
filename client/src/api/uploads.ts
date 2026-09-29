import { apiClient } from './client.js';

export const uploadImage = (file: File) => {
  const formData = new FormData();
  formData.append('image', file);
  return apiClient.post<{ url: string }>('/api/uploads/image', formData);
};
