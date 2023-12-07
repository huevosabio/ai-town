import { toast } from 'react-toastify';

export async function toastOnError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error: any) {
    toast.error(error.message);
    throw error;
  }
}

export async function notificationToast<T>(message: string) {
  toast.info(message);
}