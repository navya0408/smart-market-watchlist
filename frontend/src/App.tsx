import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
} from "react-router-dom";

import {
  AppBar,
  Avatar,
  Box,
  Button,
 
  Toolbar,
  
  Typography,
} from "@mui/material";


import Dashboard from "./Dashboard";
import WatchlistPage from "./Watchlist";
import Login from "./Login";
import Signup from "./Signup";


// =========================================================
// Protected Route
// =========================================================

function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {

  const token =
    localStorage.getItem(
      "access_token"
    );

  if (!token) {

    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  return children;
}


// =========================================================
// Navigation
// =========================================================

function Navigation() {

  const navigate = useNavigate();

  const token =
    localStorage.getItem(
      "access_token"
    );

  const userString =
  localStorage.getItem("user");

let userName = "";
let userEmail = "";

if (userString) {
  try {
    const user =
      JSON.parse(userString);

    userName = user.name || user.displayName || "";
    userEmail = user.email || "";
  } catch {
    userName = "";
    userEmail = "";
  }
}


  const handleLogout = () => {

    localStorage.removeItem(
      "access_token"
    );

    localStorage.removeItem(
      "user"
    );

    navigate("/login");
  };


return (
  <AppBar
    position="static"
    elevation={0}
    sx={{
      width: "100%",
      backgroundColor: "#1976d2",
    }}
  >
    <Toolbar
      sx={{
        minHeight: 64,
        px: {
          xs: 2,
          md: 4,
        },
      }}
    >
      {/* Brand */}
      <Typography
        component={Link}
        to="/"
        sx={{
          flexGrow: 1,
          color: "white",
          textDecoration: "none",
          fontWeight: 800,
          fontSize: {
            xs: "1rem",
            md: "1.25rem",
          },
          letterSpacing: "-0.3px",
        }}
      >
        Smart Market Watchlist
      </Typography>

      {token ? (
        <>
          {/* Dashboard */}
          <Button
            color="inherit"
            component={Link}
            to="/"
            sx={{
              fontWeight: 600,
              mx: 0.5,
            }}
          >
            Dashboard
          </Button>

          {/* Watchlists */}
          <Button
            color="inherit"
            component={Link}
            to="/watchlists"
            sx={{
              fontWeight: 600,
              mx: 0.5,
            }}
          >
            Watchlists
          </Button>

         

          {/* User */}
          {(userName || userEmail) && (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      ml: 1.5,
    }}
  >
    <Avatar
      sx={{
        width: 34,
        height: 34,
        bgcolor: "white",
        color: "#1976d2",
        fontWeight: 700,
        fontSize: "0.95rem",
      }}
    >
      {(userName || userEmail)
        .charAt(0)
        .toUpperCase()}
    </Avatar>

    <Box
      sx={{
        display: {
          xs: "none",
          md: "block",
        },
        minWidth: 0,
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        {userName || "User"}
      </Typography>

      <Typography
        variant="caption"
        sx={{
          display: "block",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          opacity: 0.85,
        }}
      >
        {userEmail}
      </Typography>
    </Box>
  </Box>
)}

          {/* Logout */}
          <Button
            color="inherit"
            onClick={handleLogout}
            sx={{
              fontWeight: 600,
              ml: 1,
            }}
          >
            Logout
          </Button>
        </>
      ) : (
        <>
          <Button
            color="inherit"
            component={Link}
            to="/login"
          >
            Login
          </Button>

          <Button
            color="inherit"
            component={Link}
            to="/signup"
          >
            Sign Up
          </Button>
        </>
      )}
    </Toolbar>
  </AppBar>
);
}


// =========================================================
// App
// =========================================================

function App() {

  return (
    <BrowserRouter>

      <Navigation />

      <Box>

        <Routes>

          <Route
            path="/login"
            element={<Login />}
          />

          <Route
            path="/signup"
            element={<Signup />}
          />


          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />


          <Route
            path="/watchlists"
            element={
              <ProtectedRoute>
                <WatchlistPage />
              </ProtectedRoute>
            }
          />


          <Route
            path="*"
            element={
              <Navigate
                to="/"
                replace
              />
            }
          />

        </Routes>

      </Box>

    </BrowserRouter>
  );
}


export default App;