import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
});


// =========================================================
// Attach JWT token to authenticated requests
// =========================================================

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});


// =========================================================
// Authentication
// =========================================================

export const signup = async (
  name: string,
  email: string,
  password: string
) => {
  try {
    const response = await api.post("/auth/signup", {
      name,
      email,
      password,
    });

    localStorage.setItem(
      "access_token",
      response.data.access_token
    );

    localStorage.setItem(
      "user",
      JSON.stringify(response.data.user)
    );

    return response.data;

    localStorage.setItem(
      "access_token",
      response.data.access_token
    );

    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error(
        "SIGNUP ERROR:",
        error.response?.data
      );

      console.error(
        "SIGNUP STATUS:",
        error.response?.status
      );

      const detail = error.response?.data?.detail;

      const message =
        typeof detail === "string"
          ? detail
          : `Signup failed (${error.response?.status ?? "network error"})`;

      throw new Error(message, {
        cause: error,
      });
    }

    console.error(
      "SIGNUP UNKNOWN ERROR:",
      error
    );

    throw new Error("Signup failed", {
      cause: error,
    });
  }
};


export const login = async (
  email: string,
  password: string
) => {
  try {
    const response = await api.post("/auth/login", {
      email,
      password,
    });

    localStorage.setItem(
      "access_token",
      response.data.access_token
    );
    localStorage.setItem(
  "user",
  JSON.stringify(response.data.user)
);
    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error(
        "LOGIN ERROR:",
        error.response?.data
      );

      console.error(
        "LOGIN STATUS:",
        error.response?.status
      );

      const detail = error.response?.data?.detail;

      const message =
        typeof detail === "string"
          ? detail
          : `Login failed (${error.response?.status ?? "network error"})`;

      throw new Error(message, {
        cause: error,
      });
    }

    console.error(
      "LOGIN UNKNOWN ERROR:",
      error
    );

    throw new Error("Login failed", {
      cause: error,
    });
  }
};


export const logout = () => {
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
};


export const isAuthenticated = (): boolean => {
  return Boolean(
    localStorage.getItem("access_token")
  );
};


export const getMe = async () => {
  const response = await api.get("/auth/me");

  return response.data;
};


// =========================================================
// Watchlists
// =========================================================

export const getWatchlists = async () => {
  const response = await api.get("/watchlists");

  return response.data;
};


export const createWatchlist = async (
  name: string
) => {
  const response = await api.post(
    "/watchlists",
    { name }
  );

  return response.data;
};

export const deleteWatchlist = async (
  watchlistId: number
) => {
  const response = await api.delete(
    `/watchlists/${watchlistId}`
  );

  return response.data;
};

export const getWatchlist = async (
  watchlistId: number
) => {
  const response = await api.get(
    `/watchlists/${watchlistId}`
  );

  return response.data;
};


export const addSymbol = async (
  watchlistId: number,
  symbol: string
) => {
  const response = await api.post(
    `/watchlists/${watchlistId}/symbols`,
    { symbol }
  );

  return response.data;
};


export const removeSymbol = async (
  watchlistId: number,
  symbol: string
) => {
  const response = await api.delete(
    `/watchlists/${watchlistId}/symbols/${symbol}`
  );

  return response.data;
};


// =========================================================
// Market Data
// =========================================================

export const getMarketQuote = async (
  symbol: string
) => {
  const response = await api.get(
    `/market/${symbol}`
  );

  return response.data;
};

export const getAttentionHistory = async (
  symbol: string,
  limit: number = 20
) => {
  const response = await api.get(
    `/market/${symbol}/attention-history`,
    {
      params: { limit },
    }
  );

  return response.data;
};

export const getSmartAnalysis = async (
  symbol: string
) => {
  const response = await api.get(
    `/market/${symbol}/smart-analysis`
  );

  return response.data;
};


// =========================================================
// Snapshots
// =========================================================

export const saveSnapshot = async (
  symbol: string,
  price: number,
  attentionScore: number
) => {
  const response = await api.post(
    `/snapshots/${symbol}`,
    null,
    {
      params: {
        price,
        attention_score: attentionScore,
      },
    }
  );

  return response.data;
};




export default api;