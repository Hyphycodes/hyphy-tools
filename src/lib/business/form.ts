export type BusinessFormState = {
  problem?: { message: string; field?: 'name' | 'type' | 'address' };
  values?: { name?: string; type?: string; address?: string };
  at?: number;
};

export const initialBusinessState: BusinessFormState = {};
