import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, ApiError } from '../api/client';

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface UseApiOptions {
  /** Skip the initial fetch; only fetch when refetch() is called */
  lazy?: boolean;
  /** Dependencies that trigger a re-fetch when changed */
  deps?: unknown[];
}

export function useApi<T>(
  url: string,
  options: UseApiOptions = {},
): UseApiState<T> {
  const { lazy = false, deps = [] } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!lazy);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<T>(url);
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred');
        }
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    if (!lazy) {
      fetchData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, lazy]);

  return { data, loading, error, refetch: fetchData };
}

export default useApi;
