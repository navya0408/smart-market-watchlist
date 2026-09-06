import { useEffect, useState } from "react";
import type { ReactNode } from "react";


import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  LinearProgress,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";

import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ShowChartIcon from "@mui/icons-material/ShowChart";

import {
  getSmartAnalysis,
  getWatchlists,
  saveSnapshot,
} from "./api";


type Watchlist = {
  id: number;
  name: string;
  symbols: string[];
};


type Analysis = {
  symbol: string;
  status: string;

  current?: {
    price: number;
    change: number;
    change_percent: string | number;
    volume: number;
    latest_trading_day: string;
    data_source?: string;
    data_status?: string;
  };

  attention?: {
    score: number;
    severity: string;
    explanation?: string;
    reasons?: string[];
    signals?: string[];

    metrics?: {
      today_return_percent?: number;
      z_score?: number;
      volume_ratio?: number;
      relative_return_percent?: number;
      highest_52w?: number;
      lowest_52w?: number;
    };

    score_breakdown?: {
      price_move?: number;
      volume?: number;
      "52_week_level"?: number;
      market_relative?: number;
    };
  };

  since_last_checked?: {
  previous_price?: number | null;
  change_percent?: number | null;
  has_previous_snapshot?: boolean;
  previous_attention_score?: number | null;
  attention_score_change?: number | null;
  checked_at?: string | null;
};

  data_quality?: {
  status?: string;
  state?: string;
  source?: string;
  message?: string;
  provider_comparison?: {
    status?: string;
    primary_source?: string;
    secondary_source?: string;
    primary_price?: number;
    secondary_price?: number;
    difference_percent?: number;
    threshold_percent?: number;
  };
};

  message?: string;
};


type StockAnalysis = Analysis & {
  symbol: string;
};


function severityLabel(
  severity: string | undefined
): string {
  if (!severity) {
    return "LOW";
  }

  return severity.toUpperCase();
}


function severityColor(
  severity: string | undefined
): "error" | "warning" | "success" {
  if (severity === "high") {
    return "error";
  }

  if (severity === "medium") {
    return "warning";
  }

  return "success";
}


function formatPercent(
  value: number | string | null | undefined
): string {
  if (value === null || value === undefined) {
    return "—";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "—";
  }

  return `${numberValue >= 0 ? "+" : ""}${numberValue.toFixed(2)}%`;
}


function formatNumber(
  value: number | null | undefined
): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (!Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(2);
}


type SafeStackProps = {
  children?: ReactNode;
  direction?: React.CSSProperties["flexDirection"];
  spacing?: number;
  justifyContent?: React.CSSProperties["justifyContent"];
  alignItems?: React.CSSProperties["alignItems"];
  flexWrap?: React.CSSProperties["flexWrap"];
  gap?: React.CSSProperties["gap"];
  style?: React.CSSProperties;
};

function Stack({
  children,
  direction = "column",
  spacing,
  justifyContent,
  alignItems,
  flexWrap,
  gap,
  style,
}: SafeStackProps) {
  const stackStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: direction,
    justifyContent,
    alignItems,
    flexWrap,
    gap:
      gap !== undefined
        ? gap
        : spacing !== undefined
          ? `${spacing * 8}px`
          : undefined,
    ...style,
  };

  return (
    <div style={stackStyle}>
      {children}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <Card
  sx={{
    height: "100%",
    borderRadius: 3,
    border: "1px solid #e1eaf5",
    backgroundColor: "#ffffff",
    boxShadow: "0 2px 10px rgba(16, 42, 86, 0.05)",
  }}
>
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          gap={1}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontWeight: 600 }}
            >
              {title}
            </Typography>

           <Typography
  variant="h4"
  sx={{
    fontWeight: 900,
    mt: 1,
    color: "#102a56",
    letterSpacing: "-0.5px",
  }}
>
  {value}
</Typography>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5 }}
            >
              {subtitle}
            </Typography>
          </Box>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}


function AttentionCard({
  stock,
  onMarkAsChecked,
}: {
  stock: StockAnalysis;
  onMarkAsChecked: (stock: StockAnalysis) => void;
}) {
  const attention = stock.attention;

  if (!attention) {
    return (
      <Card
        sx={{
          height: "100%",
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <CardContent
  sx={{
    p: 2.25,
    "&:last-child": {
      pb: 2.25,
    },
  }}
>
          <Typography
            variant="h6"
            sx={{ fontWeight: 800 }}
          >
            {stock.symbol}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            Not enough data to calculate attention.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const severity = severityColor(attention.severity);
  const score = attention.score ?? 0;

  const todayMove =
    stock.current?.change_percent;

  const sinceLastCheck =
    stock.since_last_checked;

  const attentionChange =
    sinceLastCheck?.attention_score_change;

  const hasBaseline =
    sinceLastCheck?.has_previous_snapshot === true;

  const primaryReason =
    attention.reasons?.[0] ??
    attention.explanation ??
    "No significant change detected.";

  const secondaryReason =
    attention.reasons?.[1];

  const scoreColor =
    score >= 70
      ? "error.main"
      : score >= 40
        ? "warning.main"
        : "success.main";

  return (
    <Card
      sx={{
  height: "100%",
  borderRadius: 3,
  border: "1px solid",
  borderColor:
    severity === "error"
      ? "error.light"
      : severity === "warning"
        ? "warning.light"
        : "#e1e7ef",
  backgroundColor: "#ffffff",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  transition:
    "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
  "&:hover": {
    transform: "translateY(-3px)",
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.10)",
    borderColor:
  severity === "error"
    ? "error.main"
    : severity === "warning"
      ? "warning.main"
      : "primary.light",
  },
}}
    >
      <CardContent sx={{ p: 2.5 }}>
        {/* Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          gap={1}
          flexWrap="wrap"
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 900,
                letterSpacing: "-0.5px",
                wordBreak: "break-word",
              }}
            >
              {stock.symbol}
            </Typography>

            {stock.current && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.4 }}
              >
                ${formatNumber(stock.current.price)}
              </Typography>
            )}
          </Box>

          <Chip
            icon={<WarningAmberIcon />}
            label={severityLabel(attention.severity)}
            color={severity}
            size="small"
            sx={{
              fontWeight: 800,
              borderRadius: 2,
              flexShrink: 0,
            }}
          />
        </Stack>

        {/* Score + today's move */}
        <Stack
  direction="row"
  justifyContent="space-between"
  alignItems="center"
  flexWrap="wrap"
  gap={1}
  style={{ marginTop: "20px", width: "100%" }}
>
          <Box sx={{ minWidth: 0, flex: "1 1 auto" }}>
            <Typography
              variant="caption"
              color="text.secondary"
            >
              Attention Score
            </Typography>

            <Typography
              variant="h3"
              sx={{
                fontWeight: 900,
                lineHeight: 1.1,
                color: scoreColor,
              }}
            >
              {score}
              <Typography
                component="span"
                variant="body2"
                color="text.secondary"
              >
                /100
              </Typography>
            </Typography>
          </Box>

          {stock.current && (
            <Box
  sx={{
    textAlign: "right",
    flexShrink: 0,
    minWidth: "70px",
  }}
>
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Today's move
              </Typography>

              <Typography
                variant="body1"
                sx={{
                  fontWeight: 900,
                  color:
                    Number(todayMove ?? 0) >= 0
                      ? "success.main"
                      : "error.main",
                }}
              >
                {formatPercent(todayMove)}
              </Typography>
            </Box>
          )}
        </Stack>

        {/* Score progress */}
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, score))}
          color={severity}
          sx={{
            mt: 1.5,
            height: 7,
            borderRadius: 10,
          }}
        />

        {/* Why it matters */}
        <Box
          sx={{
            mt: 2,
            minHeight: 58,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.45,
            }}
          >
            {primaryReason}
          </Typography>

          {secondaryReason && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.7,
                lineHeight: 1.4,
              }}
            >
              {secondaryReason}
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* Session-relative information */}
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6 }}>
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Since last check
              </Typography>

              <Typography
                variant="body1"
                sx={{
                  fontWeight: 900,
                  color:
                    Number(
                      sinceLastCheck?.change_percent ?? 0
                    ) >= 0
                      ? "success.main"
                      : "error.main",
                }}
              >
                {hasBaseline
                  ? formatPercent(
                      sinceLastCheck?.change_percent
                    )
                  : "First check"}
              </Typography>
            </Box>
          </Grid>

          <Grid size={{ xs: 6 }}>
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Attention change
              </Typography>

              <Typography
                variant="body1"
                sx={{
                  fontWeight: 900,
                  color:
                    Number(attentionChange ?? 0) > 0
                      ? "error.main"
                      : Number(attentionChange ?? 0) < 0
                        ? "success.main"
                        : "text.secondary",
                }}
              >
                {attentionChange === null ||
                attentionChange === undefined
                  ? "—"
                  : `${Number(attentionChange) >= 0 ? "+" : ""}${Number(
                      attentionChange
                    ).toFixed(0)} pts`}
              </Typography>
            </Box>
          </Grid>
        </Grid>

        {/* Data quality */}
        {stock.data_quality && (
          <Stack
            direction="row"
            alignItems="center"
            flexWrap="wrap"
            gap={0.7}
            style={{ marginTop: "16px" }}
          >
            <Chip
              size="small"
              label={`Data: ${
                stock.data_quality.status ?? "unknown"
              }`}
              variant="outlined"
            />

            <Chip
              size="small"
              label={`Market: ${
                stock.data_quality.state ?? "unknown"
              }`}
              variant="outlined"
            />
          </Stack>
        )}

        {/* Actions */}
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          style={{ marginTop: "16px", rowGap: "8px" }}
        >
          <Button
            fullWidth
            variant="outlined"
            size="small"
            onClick={() => {
              window.location.href = "/watchlists";
            }}
            sx={{
              fontWeight: 800,
              borderRadius: 2,
              flex: "1 1 130px",
              minWidth: 0,
            }}
          >
            View Details
          </Button>

          <Button
            fullWidth
            variant={
              hasBaseline
                ? "outlined"
                : "contained"
            }
            size="small"
            onClick={() => onMarkAsChecked(stock)}
            disabled={
              !stock.current || !stock.attention
            }
            sx={{
              fontWeight: 800,
              borderRadius: 2,
              flex: "1 1 130px",
              minWidth: 0,
            }}
          >
            {hasBaseline
  ? "Update Baseline"
  : "Mark as Checked"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}



export default function Dashboard() {
  const [
    watchlists,
    setWatchlists,
  ] = useState<Watchlist[]>([]);

  const [
    analyses,
    setAnalyses,
  ] = useState<StockAnalysis[]>([]);

  const [
    loading,
    setLoading,
  ] = useState<boolean>(true);

  const [
    error,
    setError,
  ] = useState<string>("");


  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        setError("");

        const lists: Watchlist[] =
          await getWatchlists();

        const normalizedLists =
          Array.isArray(lists)
            ? lists
            : [];

        setWatchlists(
          normalizedLists
        );

        const uniqueSymbols =
          Array.from(
            new Set(
              normalizedLists.flatMap(
                (watchlist) =>
                  Array.isArray(
                    watchlist.symbols
                  )
                    ? watchlist.symbols
                    : []
              )
            )
          );

        const results =
          await Promise.all(
            uniqueSymbols.map(
              async (symbol) => {
                try {
                  return await getSmartAnalysis(
                    symbol
                  );
                } catch {
                  return {
                    symbol,
                    status: "error",
                    message:
                      "Unable to analyze this stock.",
                  };
                }
              }
            )
          );

        const stocks: StockAnalysis[] =
          results.map(
            (
              result: Analysis,
              index
            ) => ({
              ...result,
              symbol:
                result.symbol ||
                uniqueSymbols[index],
            })
          );

        setAnalyses(stocks);
      } catch {
        setError(
          "Unable to load dashboard data. Please try again."
        );
      } finally {
        setLoading(false);
      }
    };

    const timer =
      setTimeout(loadDashboard, 0);

    return () => {
      clearTimeout(timer);
    };
  }, []);


  const highAttention =
    analyses.filter(
      (stock) =>
        stock.attention?.severity ===
        "high"
    );

  const mediumAttention =
    analyses.filter(
      (stock) =>
        stock.attention?.severity ===
        "medium"
    );

  const changedStocks =
  analyses.filter((stock) => {
    const change = Number(
      stock.since_last_checked?.change_percent ?? 0
    );

    return (
      stock.since_last_checked
        ?.has_previous_snapshot === true &&
      Math.abs(change) >= 0.1
    );
  });

  const rankedStocks =
    [...analyses].sort(
      (a, b) =>
        (b.attention?.score ?? 0) -
        (a.attention?.score ?? 0)
    );

 
const handleMarkAsChecked = async (stock: StockAnalysis) => {
  if (!stock.current || !stock.attention) return;

  try {
    await saveSnapshot(
      stock.symbol,
      Number(stock.current.price),
      Number(stock.attention.score)
    );

    const updated = await getSmartAnalysis(stock.symbol);

    setAnalyses((previous) =>
      previous.map((item) =>
        item.symbol === stock.symbol
          ? { ...updated, symbol: stock.symbol }
          : item
      )
    );
  } catch {
    setError(
      `Unable to save ${stock.symbol} baseline. Please try again.`
    );
  }
};

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }


  return (
    <Box
  sx={{
    minHeight: "calc(100vh - 64px)",
    backgroundColor: "#f7faff",
    color: "#102a56",
    width: "100%",
    maxWidth: "100vw",
    overflowX: "hidden",
    boxSizing: "border-box",
    py: {
      xs: 3,
      md: 4,
    },
    px: {
      xs: 2,
      sm: 3,
      lg: 4,
    },
  }}
>
  <Box
  sx={{
    width: "100%",
    maxWidth: 1240,
    minWidth: 0,
    mx: "auto",
    boxSizing: "border-box",
  }}
>
  <Box
  sx={{
    mb: 2.5,
    display: "flex",
    justifyContent: "space-between",
    alignItems: {
      xs: "flex-start",
      md: "flex-end",
    },
    flexDirection: {
      xs: "column",
      md: "row",
    },
    gap: 2,
  }}
>
  <Box>
    <Typography
      variant="h3"
      sx={{
        fontWeight: 900,
        letterSpacing: "-1.5px",
        color: "#102a56",
        fontSize: {
          xs: "2rem",
          md: "2.6rem",
        },
      }}
    >
      Market Attention
    </Typography>

    <Typography
      variant="body1"
      sx={{
        mt: 0.5,
        color: "#58709a",
        fontSize: "1rem",
      }}
    >
      Focus on what meaningfully changed instead
      of watching every stock.
    </Typography>
  </Box>

  {analyses.length > 0 && (
    <Box sx={{ textAlign: { xs: "left", md: "right" } }}>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 700,
          color: "#193764",
        }}
      >
        Latest market data
      </Typography>

      <Typography
        variant="caption"
        color="text.secondary"
      >
        {analyses
          .map(
            (stock) =>
              stock.current?.latest_trading_day
          )
          .filter(Boolean)
          .sort()
          .at(-1) ?? "—"}
      </Typography>
    </Box>
  )}
</Box>


      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
        >
          {error}
        </Alert>
      )}


      {/* =====================================================
          Summary
      ===================================================== */}

      <Box
  sx={{
    mb: 4,
    display: "grid",
    gridTemplateColumns: {
      xs: "1fr",
      sm: "repeat(2, minmax(0, 1fr))",
      md: "repeat(4, minmax(0, 1fr))",
    },
    gap: 2,
    width: "100%",
    minWidth: 0,
  }}
>
        <Box sx={{ minWidth: 0 }}>
          <StatCard
            title="Stocks Tracked"
            value={analyses.length}
            subtitle="Across your watchlists"
            icon={
              <ShowChartIcon
                sx={{
                  fontSize: 38,
                  opacity: 0.9,
                }}
              />
            }
          />
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <StatCard
            title="High Attention"
            value={highAttention.length}
            subtitle="Needs attention now"
            icon={
              <WarningAmberIcon
                sx={{
                  fontSize: 38,
                  opacity: 0.9,
                }}
              />
            }
          />
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <StatCard
            title="Medium Attention"
            value={mediumAttention.length}
            subtitle="Worth monitoring"
            icon={
              <VisibilityIcon
                sx={{
                  fontSize: 38,
                  opacity: 0.9,
                }}
              />
            }
          />
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <StatCard
            title="Changed"
            value={changedStocks.length}
            subtitle="Since your last check"
            icon={
              <TrendingUpIcon
                sx={{
                  fontSize: 38,
                  opacity: 0.9,
                }}
              />
            }
          />
        </Box>
      </Box>


      {/* =====================================================
          Highest Priority
      ===================================================== */}

      {rankedStocks.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{ mb: 2 }}>
  <Typography
    variant="h5"
    sx={{
      fontWeight: 900,
      color: "#102a56",
      letterSpacing: "-0.4px",
    }}
  >
    What Deserves Attention Now
  </Typography>

  <Typography
    variant="body2"
    sx={{
      mt: 0.4,
      color: "#6b7f9f",
    }}
  >
    Ranked by your smart attention score — not simply by price movement.
  </Typography>
</Box>

          <Grid
  container
  spacing={2}
  sx={{
    width: "calc(100% - 16px)",
    margin: 0,
  }}
>
            {rankedStocks
              .slice(0, 3)
              .map((stock) => (
                <Grid
  size={{
    xs: 12,
    sm: 6,
    md: 6,
    lg: 4,
  }}
  sx={{ minWidth: 0 }}
>
                  <AttentionCard
     stock={stock}
     onMarkAsChecked={handleMarkAsChecked}
     />
                </Grid>
              ))}
          </Grid>
        </Box>
      )}


      {/* =====================================================
    Changed Since Last Check
===================================================== */}

<Box sx={{ mb: 4 }}>
  <Box
    sx={{
      backgroundColor: "#ffffff",
      border: "1px solid #e1eaf5",
      borderRadius: 3,
      p: {
        xs: 2,
        md: 2.5,
      },
      boxShadow:
        "0 2px 10px rgba(16, 42, 86, 0.04)",
    }}
  >
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      style={{ marginBottom: "16px" }}
    >
      <Box>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 900,
            color: "#102a56",
          }}
        >
          Changed Since Your Last Check
        </Typography>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.4 }}
        >
          Stocks with notable changes since your previous analysis.
        </Typography>
      </Box>

      <Button
        variant="text"
        sx={{
          fontWeight: 800,
          textTransform: "none",
        }}
        onClick={() => {
          window.location.href = "/watchlists";
        }}
      >
        View All →
      </Button>
    </Stack>

    {changedStocks.length === 0 ? (
      <Box
        sx={{
          py: 4,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        <Typography sx={{ fontWeight: 700 }}>
          No notable changes since your last check.
        </Typography>

        <Typography
          variant="body2"
          sx={{ mt: 0.5 }}
        >
          Changes of less than 0.1% are not shown here.
        </Typography>
      </Box>
    ) : (
      <Box
        sx={{
          overflowX: "auto",
          border: "1px solid #e6edf6",
          borderRadius: 2,
        }}
      >
        <Table
          size="small"
          sx={{
            minWidth: 650,
          }}
        >
          <TableHead>
            <TableRow
              sx={{
                backgroundColor: "#f7faff",
              }}
            >
              <TableCell sx={{ fontWeight: 800 }}>
                Symbol
              </TableCell>

              <TableCell sx={{ fontWeight: 800 }}>
                Price
              </TableCell>

              <TableCell sx={{ fontWeight: 800 }}>
                Change
              </TableCell>

              <TableCell sx={{ fontWeight: 800 }}>
                Attention 
              </TableCell>

              <TableCell sx={{ fontWeight: 800 }}>
                Last Checked
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {[...changedStocks]
              .sort(
                (a, b) =>
                  Math.abs(
                    Number(
                      b.since_last_checked
                        ?.change_percent ?? 0
                    )
                  ) -
                  Math.abs(
                    Number(
                      a.since_last_checked
                        ?.change_percent ?? 0
                    )
                  )
              )
              .slice(0, 6)
              .map((stock) => {
                const change = Number(
                  stock.since_last_checked
                    ?.change_percent ?? 0
                );

                const attentionChange =
                  stock.since_last_checked
                    ?.attention_score_change;

                const checkedAt =
                  stock.since_last_checked?.checked_at;

                return (
                  <TableRow
  key={`changed-${stock.symbol}`}
  hover
  sx={{
    backgroundColor: "#ffffff",
    transition: "all 0.2s ease",
    "&:hover": {
      backgroundColor: "#f8fbff",
    },
  }}
>
                    <TableCell>
  <Typography
    variant="subtitle1"
    sx={{
      fontWeight: 900,
      color: "#102a56",
    }}
  >
    {stock.symbol}
  </Typography>
</TableCell>

                    <TableCell>
                      $
                      {formatNumber(
                        stock.current?.price
                      )}
                    </TableCell>

                    <TableCell>
  <Typography
    variant="body2"
    sx={{
      fontWeight: 800,
      color:
        change >= 0
          ? "success.main"
          : "error.main",
    }}
  >
    {change >= 0 ? "+" : ""}
    {change.toFixed(2)}%
  </Typography>
</TableCell>

                    <TableCell
                      sx={{
                        fontWeight: 800,
                        color:
                          Number(
                            attentionChange ?? 0
                          ) > 0
                            ? "error.main"
                            : Number(
                                  attentionChange ?? 0
                                ) < 0
                              ? "success.main"
                              : "text.secondary",
                      }}
                    >
                      {attentionChange === null ||
                      attentionChange === undefined
                        ? "—"
                        : `${
                            Number(
                              attentionChange
                            ) >= 0
                              ? "+"
                              : ""
                          }${Number(
                            attentionChange
                          ).toFixed(0)} pts`}
                    </TableCell>

                    <TableCell>
  <Typography
    variant="body2"
    color="text.secondary"
  >
    {checkedAt
      ? new Date(
          checkedAt
        ).toLocaleDateString()
      : "—"}
  </Typography>
</TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Box>
    )}
  </Box>
</Box>


      {/* =====================================================
          Watchlists
      ===================================================== */}

      <Box>
        <Typography
          variant="h5"
          sx={{
  fontWeight: 900,
  mb: 2,
  color: "#102a56",
  letterSpacing: "-0.4px",
}}
        >
          Your Watchlists
        </Typography>

        {watchlists.length === 0 ? (
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography
                sx={{ fontWeight: 700 }}
              >
                No watchlists yet
              </Typography>

              <Typography
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Create your first watchlist to
                start tracking meaningful market
                changes.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Grid
  container
  spacing={2}
  sx={{
    width: "calc(100% - 16px)",
    margin: 0,
  }}
>
            {watchlists.map(
              (watchlist) => (
                <Grid
                  size={{
                    xs: 12,
                    sm: 6,
                    md: 4,
                  }}
                  key={watchlist.id}
                  sx={{ minWidth: 0 }}
                >
                  <Card
                    sx={{
                      borderRadius: 3,
                      minWidth: 0,
                    }}
                  >
                    <CardContent>
                      <Typography
                        variant="h6"
                        sx={{
                          fontWeight: 800,
                        }}
                      >
                        {watchlist.name}
                      </Typography>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {watchlist.symbols
                          ?.length ?? 0}{" "}
                        stocks tracked
                      </Typography>

                      <Stack
      direction="row"
      flexWrap="wrap"
      gap={1}
      style={{ marginTop: "16px" }}
     >
                        {watchlist.symbols
                          ?.slice(0, 8)
                          .map(
                            (symbol) => (
                              <Chip
                                key={`${watchlist.id}-${symbol}`}
                                label={symbol}
                                size="small"
                                variant="outlined"
                              />
                            )
                          )}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              )
            )}
          </Grid>
        )}
      </Box>
    </Box>
  </Box>
  );
}