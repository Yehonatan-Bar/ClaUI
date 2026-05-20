interface UserProfile {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}

const MAX_RETRIES = 3;
const TIMEOUT_MS = 5000;
const API_VERSION = 'v2';

async function fetchData(endpoint: string): Promise<UserProfile[]> {
  const response = await fetch(`/api/${API_VERSION}/${endpoint}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export { UserProfile, calculateTotal, fetchData };
