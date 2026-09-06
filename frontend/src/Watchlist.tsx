import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  TextField,
  Typography,
} from "@mui/material";


import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import InsightsIcon from "@mui/icons-material/Insights";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";

import {
  getWatchlists,
  createWatchlist,
  addSymbol,
  removeSymbol,
  getMarketQuote,
  getSmartAnalysis,
  saveSnapshot,
  getAttentionHistory,
  deleteWatchlist,
} from "./api";

interface Watchlist {
  id: number;
  name: string;
  symbols: string[];
}

interface MarketQuote {
  symbol: string;
  price: number;
  change: number;
  change_percent: string;
  volume: number;
  latest_trading_day: string;
  data_source?: string;
  data_status?: string;
}

interface SmartAnalysis {
  symbol: string;
  status: string;

  current: MarketQuote;

  attention: {
    attention_score: number;
    severity: string;
    explanation: string;
    direction: string;

    z_score?: number;
    volume_ratio?: number;

    price_score?: number;
    volume_score?: number;
    level_score?: number;
    relative_score?: number;

    level_break?: string | null;
    benchmark?: string | null;
    relative_return?: number | null;

    score_breakdown?: {
      price_move?: number;
      volume?: number;
      "52_week_level"?: number;
      market_relative?: number;
    };

    metrics?: {
      today_return_percent?: number;
      z_score?: number;
      volume_ratio?: number;
      relative_return_percent?: number;
      highest_52w?: number;
      lowest_52w?: number;
    };
  };

  since_last_checked: {
    previous_price: number | null;
    change_percent: number | null;
    has_previous_snapshot: boolean;
  };

}
interface AttentionHistoryItem {
  id: number;
  score: number;
  severity: string;
  reasons: string[];
  today_return: number;
  volume_ratio: number;
  explanation: string;
  computed_at: string;
}



const safeNumber = (
  value: unknown,
  fallback = 0
): number => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
};


const formatCurrency = (value: unknown) => {
  const number = safeNumber(value);

  return `$${number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatNumber = (value: unknown) => {
  const number = safeNumber(value);

  return number.toLocaleString("en-US");
};

const formatPercent = (
  value: unknown,
  decimals = 2
) => {
  const number = safeNumber(value);

  return `${number >= 0 ? "+" : ""}${number.toFixed(
    decimals
  )}%`;
};

const getSeverityColor = (
  severity: string
): "error" | "warning" | "success" | "default" => {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "success";

  return "default";
};

const getScoreColor = (
  score: number
): "error" | "warning" | "success" => {
  if (score >= 70) return "error";
  if (score >= 40) return "warning";

  return "success";
};

const getScoreBreakdown = (
  analysis: SmartAnalysis
) => {
  const attention = analysis.attention;

  return {
    price: safeNumber(
      attention.price_score ??
        attention.score_breakdown?.price_move
    ),

    volume: safeNumber(
      attention.volume_score ??
        attention.score_breakdown?.volume
    ),

    level: safeNumber(
      attention.level_score ??
        attention.score_breakdown?.["52_week_level"]
    ),

    relative: safeNumber(
      attention.relative_score ??
        attention.score_breakdown?.market_relative
    ),
  };
};

function ScoreRing({
  score,
}: {
  score: number;
}) {
  const color = getScoreColor(score);

  return (
    <Box
      sx={{
        width: 92,
        height: 92,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: `conic-gradient(
          ${
            color === "error"
              ? "#d32f2f"
              : color === "warning"
                ? "#ed6c02"
                : "#2e7d32"
          } ${Math.min(score, 100)}%,
          #e8edf3 ${Math.min(score, 100)}%
        )`,
        position: "relative",
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          bgcolor: "background.paper",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography
          variant="h5"
          sx={{
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          {score}
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
        >
          /100
        </Typography>
      </Box>
    </Box>
  );
}

function MetricBox({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 2,
        bgcolor: "background.default",
        border: "1px solid",
        borderColor: "divider",
        minWidth: 0,
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: "block",
          mb: 0.5,
          fontWeight: 600,
        }}
      >
        {label}
      </Typography>

     <Typography
  sx={{
    fontWeight: 800,
    fontSize: "1rem",
    color: "text.primary",
  }}
>
  {value}
</Typography>

      {helper && (
        <Typography
          variant="caption"
          color="text.secondary"
        >
          {helper}
        </Typography>
      )}
    </Box>
  );
}

function ScoreComponent({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const percentage =
    max > 0
      ? Math.min((value / max) * 100, 100)
      : 0;

  return (
    <Box sx={{ mb: 1.75 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          mb: 0.6,
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontWeight: 600 }}
        >
          {label}
        </Typography>

        <Typography
          variant="body2"
          sx={{ fontWeight: 800 }}
        >
          {value.toFixed(1)}/{max}
        </Typography>
      </Box>

      <LinearProgress
        variant="determinate"
        value={percentage}
        sx={{
          height: 7,
          borderRadius: 5,
          bgcolor: "action.hover",
          "& .MuiLinearProgress-bar": {
            borderRadius: 5,
          },
        }}
      />
    </Box>
  );
}

function AttentionCard({
  analysis,
  onCheck,
}: {
  analysis: SmartAnalysis;
  onCheck: (symbol: string) => void;
}) {
    const [attentionHistory, setAttentionHistory] =
  useState<AttentionHistoryItem[]>([]);

const [historyLoading, setHistoryLoading] =
  useState(false);

const [historyOpen, setHistoryOpen] =
  useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);

        const data = await getAttentionHistory(
          analysis.symbol,
          20
        );

        if (!cancelled) {
          setAttentionHistory(
            Array.isArray(data?.history)
              ? data.history
              : []
          );
        }
      } catch (error) {
        console.error(
          `Failed to load attention history for ${analysis.symbol}:`,
          error
        );

        if (!cancelled) {
          setAttentionHistory([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [analysis.symbol]);
  const score = safeNumber(
    analysis.attention.attention_score
  );

  const severity =
    analysis.attention.severity || "low";

  const severityColor =
    getSeverityColor(severity);

  const breakdown =
    getScoreBreakdown(analysis);

  const relativeReturn =
    analysis.attention.relative_return ??
    analysis.attention.metrics
      ?.relative_return_percent;

  const volumeRatio =
    analysis.attention.volume_ratio ??
    analysis.attention.metrics?.volume_ratio;

  const zScore =
    analysis.attention.z_score ??
    analysis.attention.metrics?.z_score;

  const todayMove =
    analysis.current.change;

  const isDown =
    analysis.attention.direction === "down" ||
    todayMove < 0;

  const hasPrevious =
    analysis.since_last_checked
      .has_previous_snapshot;

  const sinceChange =
    analysis.since_last_checked.change_percent;

  return (
    <Card
      sx={{
        height: "100%",
        borderRadius: 3,
        border: "1px solid",
        borderColor:
          severity === "high"
            ? "error.light"
            : severity === "medium"
              ? "warning.light"
              : "divider",
        boxShadow:
          severity === "high"
            ? "0 8px 30px rgba(211,47,47,0.10)"
            : "0 4px 18px rgba(0,0,0,0.05)",
      }}
    >
      <CardContent
  sx={{
    p: { xs: 2, md: 2.5 },
  }}
>
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 2,
            mb: 2,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexWrap: "wrap",
              }}
            >
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                }}
              >
                {analysis.symbol}
              </Typography>

              {isDown ? (
                <TrendingDownIcon
                  color="error"
                  fontSize="small"
                />
              ) : (
                <TrendingUpIcon
                  color="success"
                  fontSize="small"
                />
              )}

              <Chip
                size="small"
                label={`${severity.toUpperCase()} ATTENTION`}
                color={severityColor}
                icon={
                  severity === "high" ? (
                    <WarningAmberIcon />
                  ) : undefined
                }
                sx={{
                  fontWeight: 800,
                  fontSize: "0.68rem",
                }}
              />
            </Box>

            <Typography
              variant="h6"
              sx={{
                mt: 0.75,
                fontWeight: 800,
              }}
            >
              {formatCurrency(
                analysis.current.price
              )}
            </Typography>
          </Box>

          <ScoreRing score={score} />
        </Box>

        {/* Main explanation */}
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            bgcolor:
              severity === "high"
                ? "rgba(211,47,47,0.06)"
                : severity === "medium"
                  ? "rgba(237,108,2,0.06)"
                  : "rgba(46,125,50,0.06)",
            border: "1px solid",
            borderColor:
              severity === "high"
                ? "error.lighter"
                : severity === "medium"
                  ? "warning.lighter"
                  : "success.lighter",
            mb: 2.5,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              lineHeight: 1.6,
            }}
          >
            {analysis.attention.explanation ||
              "No major unusual signal was detected."}
          </Typography>
        </Box>

        {/* Metrics */}
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 800,
            mb: 1.25,
          }}
        >
          Market Signals
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr 1fr",
              sm: "repeat(4, 1fr)",
            },
            gap: 1,
            mb: 2.5,
          }}
        >
          <MetricBox
            label="Today's Move"
            value={formatPercent(todayMove)}
          />

          <MetricBox
            label="Volume Ratio"
            value={
              volumeRatio !== undefined
                ? `${safeNumber(
                    volumeRatio
                  ).toFixed(1)}×`
                : "—"
            }
          />

          <MetricBox
            label="Market Relative"
            value={
              relativeReturn !== undefined
                ? formatPercent(relativeReturn)
                : "—"
            }
          />

          <MetricBox
            label="Z-Score"
            value={
              zScore !== undefined
                ? safeNumber(
                    zScore
                  ).toFixed(2)
                : "—"
            }
          />
        </Box>

        <Divider sx={{ mb: 2.5 }} />

        {/* Why score */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: 2,
          }}
        >
          <InsightsIcon
            color="primary"
            fontSize="small"
          />

          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 900 }}
          >
            Why this score?
          </Typography>
        </Box>

        <ScoreComponent
          label="Price Move"
          value={breakdown.price}
          max={40}
        />

        <ScoreComponent
          label="Volume Anomaly"
          value={breakdown.volume}
          max={30}
        />

        <ScoreComponent
          label="52-Week Level"
          value={breakdown.level}
          max={20}
        />

        <ScoreComponent
          label="Market Relative"
          value={breakdown.relative}
          max={10}
        />

        {/* Optional level signal */}
        {analysis.attention.level_break && (
          <Box
            sx={{
              mt: 1,
              p: 1.5,
              borderRadius: 2,
              bgcolor: "action.hover",
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 600 }}
            >
              <strong>Level signal:</strong>{" "}
              {analysis.attention.level_break ===
              "52_week_high"
                ? "52-week high breakout"
                : analysis.attention.level_break ===
                    "52_week_low"
                  ? "52-week low breakout"
                  : analysis.attention.level_break}
            </Typography>
          </Box>
        )}
                {/* Attention History */}
<Box
  sx={{
    mt: 2,
    border: "1px solid",
    borderColor: "divider",
    borderRadius: 2,
    overflow: "hidden",
  }}
>
  <Box
    component="button"
    type="button"
    onClick={() =>
      setHistoryOpen((previous) => !previous)
    }
    sx={{
  width: "100%",
  border: 0,
  background: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
  px: 1.75,
  py: 1.25,
  cursor: "pointer",
  textAlign: "left",
  color: "text.primary",
  transition:
    "background-color 0.18s ease",

  "&:hover": {
    bgcolor: "grey.100",
  },

  "&:hover .attention-history-title": {
    color: "text.primary",
  },

  "&:focus-visible": {
    outline: "2px solid",
    outlineColor: "primary.main",
    outlineOffset: "-2px",
  },
}}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
      }}
    >
      <ShowChartIcon
        fontSize="small"
        color="primary"
      />

      <Typography
  variant="body2"
  className="attention-history-title"
  sx={{
    fontWeight: 800,
    color: "text.primary",
    transition: "color 0.18s ease",
  }}
>
  Attention History
</Typography>

      {attentionHistory.length > 0 && (
        <Chip
  size="small"
  label={`${attentionHistory.length} checks`}
  variant="outlined"
  sx={{
    height: 22,
    fontSize: "0.68rem",
    fontWeight: 800,
    color: "text.primary",
    borderColor: "grey.400",
    backgroundColor: "grey.50",
    "&:hover": {
  backgroundColor: "grey.200",
}
  }}
/>
      )}
    </Box>

    <Typography
      variant="caption"
      color="primary"
      sx={{
        fontWeight: 800,
      }}
    >
      {historyOpen ? "Hide" : "View"}
    </Typography>
  </Box>

  {historyOpen && (
    <Box
      sx={{
        px: 1.75,
        pb: 1.5,
        pt: 0.5,
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      {historyLoading ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            py: 1.5,
          }}
        >
          <CircularProgress size={16} />

          <Typography
            variant="caption"
            color="text.secondary"
          >
            Loading history...
          </Typography>
        </Box>
      ) : attentionHistory.length === 0 ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: "block",
            py: 1,
          }}
        >
          No attention history available yet.
        </Typography>
      ) : (
        <Box
  sx={{
    display: "grid",
    gridTemplateColumns: {
      xs: "1fr",
      sm: "1fr 1fr",
    },
    gap: 0.75,
    pt: 1,
    maxHeight: 300,
    overflowY: "auto",
    pr: 0.5,
  }}
>
          {attentionHistory
            .map((item, index) => {
              const previous =
                attentionHistory[index + 1];

              const scoreChange = previous
                ? item.score - previous.score
                : null;

              return (
                <Box
                  key={item.id}
                  sx={{
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
  p: 1,
  borderRadius: 1.5,
  bgcolor: "grey.100",
  border: "1px solid",
  borderColor: "transparent",
  transition:
    "background-color 0.18s ease, border-color 0.18s ease",

  "&:hover": {
    bgcolor: "grey.200",
    borderColor: "grey.300",
  },
}}
                >
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 800,
                      }}
                    >
                      {item.score}/100
                    </Typography>

                    <Typography
                      variant="caption"
                      color="text.secondary"
                    >
                      {new Date(
                        item.computed_at
                      ).toLocaleString()}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    <Chip
                      size="small"
                      label={item.severity.toUpperCase()}
                      color={getSeverityColor(
                        item.severity
                      )}
                      sx={{
                        height: 22,
                        fontSize: "0.65rem",
                        fontWeight: 800,
                      }}
                    />

                    {scoreChange !== null && (
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 800,
                          color:
                            scoreChange > 0
                              ? "error.main"
                              : scoreChange < 0
                                ? "success.main"
                                : "text.secondary",
                        }}
                      >
                        {scoreChange > 0
                          ? `+${scoreChange}`
                          : scoreChange}{" "}
                        pts
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
        </Box>
      )}
    </Box>
  )}
</Box>
        {/* Since last checked */}
        <Box
          sx={{
            mt: 2,
             px: 1.5,
            py: 1.25,
            borderRadius: 2,
            border: "1px solid",
            borderColor: hasPrevious
              ? "primary.light"
              : "divider",
            bgcolor: hasPrevious
              ? "rgba(25,118,210,0.04)"
              : "background.default",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 0.5,
            }}
          >
            <VisibilityOutlinedIcon
              fontSize="small"
              color="primary"
            />

            <Typography
              variant="body2"
              sx={{ fontWeight: 800 }}
            >
              Since you last checked
            </Typography>
          </Box>

          {hasPrevious &&
          sinceChange !== null ? (
            <Typography
              variant="body2"
              sx={{ fontWeight: 700 }}
            >
              {formatPercent(sinceChange)}{" "}
              from{" "}
              {formatCurrency(
                analysis.since_last_checked
                  .previous_price
              )}
            </Typography>
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              First check — baseline has not
              been set yet.
            </Typography>
          )}
        </Box>

        {/* Footer */}
        <Box
          sx={{
            mt: 2.5,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <AccessTimeIcon
              fontSize="small"
              color="disabled"
            />

            <Typography
              variant="caption"
              color="text.secondary"
            >
              {analysis.current
                .latest_trading_day ||
                "Trading day unavailable"}
            </Typography>
          </Box>

          <Button
            size="small"
            variant={
              hasPrevious
                ? "outlined"
                : "contained"
            }
            startIcon={
              <CheckCircleIcon />
            }
            onClick={() =>
              onCheck(analysis.symbol)
            }
          >
            {hasPrevious
              ? "Update Baseline"
              : "Mark as Checked"}
          </Button>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: "block",
            mt: 1,
            textAlign: "right",
          }}
        >
          Data:{" "}
          {analysis.current.data_status ===
          "fresh"
            ? "Fresh"
            : analysis.current.data_status ===
                "stale"
              ? "Stale"
              : "Status unknown"}
          {analysis.current.data_source
            ? ` • ${analysis.current.data_source}`
            : ""}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function WatchlistPage() {
  const [watchlists, setWatchlists] =
    useState<Watchlist[]>([]);
    
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  const [
    selectedWatchlist,
    setSelectedWatchlist,
  ] = useState<number | null>(null);

  const [marketData, setMarketData] =
    useState<Record<string, MarketQuote>>({});

  const [smartAnalysis, setSmartAnalysis] =
    useState<Record<string, SmartAnalysis>>({});

  const [marketErrors, setMarketErrors] =
    useState<Record<string, string>>({});

  const [loadingMarketData, setLoadingMarketData] =
    useState(false);

  const [pageError, setPageError] =
    useState("");
    
  const loadMarketData = async (
    symbols: string[]
  ) => {
    setLoadingMarketData(true);
    setMarketErrors({});

    const quotes: Record<
      string,
      MarketQuote
    > = {};

    const analyses: Record<
      string,
      SmartAnalysis
    > = {};

    const errors: Record<string, string> =
      {};

    for (const rawSymbol of symbols) {
      const stockSymbol = rawSymbol
        .toUpperCase()
        .trim();

      if (!stockSymbol) continue;

      try {
        const quote =
          await getMarketQuote(stockSymbol);

        if (
          !quote ||
          quote.status === "not_available"
        ) {
          errors[stockSymbol] =
            quote?.message ||
            "Market data is currently unavailable.";

          continue;
        }

        quotes[stockSymbol] =
          quote as MarketQuote;

        try {
          const analysis =
            await getSmartAnalysis(
              stockSymbol
            );

          if (
            analysis &&
            analysis.status === "ok"
          ) {
            analyses[stockSymbol] =
              analysis as SmartAnalysis;
          } else if (
            analysis?.status ===
            "insufficient_data"
          ) {
            errors[stockSymbol] =
              "Current price is available, but there is not enough historical data for smart analysis.";
          }
        } catch (analysisError) {
          console.error(
            `Smart analysis failed for ${stockSymbol}:`,
            analysisError
          );

          errors[stockSymbol] =
            "Market data is available, but smart analysis could not be calculated.";
        }
      } catch (error) {
        console.error(
          `Market data failed for ${stockSymbol}:`,
          error
        );

        errors[stockSymbol] =
          "Unable to retrieve market data. Please try again later.";
      }
    }

    setMarketData(quotes);
    setSmartAnalysis(analyses);
    setMarketErrors(errors);
    setLoadingMarketData(false);
  };

  const loadWatchlists = async () => {
    try {
      setPageError("");

      const data: Watchlist[] =
        await getWatchlists();

      setWatchlists(data);

      if (data.length === 0) {
        setSelectedWatchlist(null);
        setMarketData({});
        setSmartAnalysis({});
        return;
      }

      const currentId =
        selectedWatchlist &&
        data.some(
          (watchlist) =>
            watchlist.id ===
            selectedWatchlist
        )
          ? selectedWatchlist
          : data[0].id;

      setSelectedWatchlist(currentId);

      const current =
        data.find(
          (watchlist) =>
            watchlist.id === currentId
        );

      if (current) {
        await loadMarketData(
          current.symbols
        );
      }
    } catch (error) {
      console.error(
        "Failed to load watchlists:",
        error
      );

      setPageError(
        "Unable to load your watchlists."
      );
    }
  };

 useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  loadWatchlists();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

  const currentWatchlist =
    watchlists.find(
      (watchlist) =>
        watchlist.id ===
        selectedWatchlist
    );

  const attentionStocks = useMemo(() => {
    if (!currentWatchlist) return [];

    return currentWatchlist.symbols
      .filter(
        (stock) =>
          Boolean(smartAnalysis[stock])
      )
      .sort(
        (a, b) =>
          safeNumber(
            smartAnalysis[b].attention
              .attention_score
          ) -
          safeNumber(
            smartAnalysis[a].attention
              .attention_score
          )
      );
  }, [
    currentWatchlist,
    smartAnalysis,
  ]);

  const highAttentionCount =
    attentionStocks.filter(
      (stock) =>
        smartAnalysis[stock].attention
          .severity === "high"
    ).length;

  const mediumAttentionCount =
    attentionStocks.filter(
      (stock) =>
        smartAnalysis[stock].attention
          .severity === "medium"
    ).length;

  const meaningfulAttentionStocks =
    attentionStocks.filter(
      (stock) =>
        safeNumber(
          smartAnalysis[stock].attention
            .attention_score
        ) >= 40
    );

  const handleCreateWatchlist =
    async () => {
      if (!name.trim()) return;

      try {
        setPageError("");

        const newWatchlist =
          await createWatchlist(
            name.trim()
          );

        setWatchlists((prev) => [
          ...prev,
          newWatchlist,
        ]);

        setSelectedWatchlist(
          newWatchlist.id
        );

        setName("");

        await loadMarketData(
          newWatchlist.symbols || []
        );
      } catch (error) {
        console.error(
          "Failed to create watchlist:",
          error
        );

        setPageError(
          "Could not create the watchlist."
        );
      }
    };

  const handleDeleteWatchlist = async () => {
  if (!currentWatchlist) return;

  const confirmed = window.confirm(
    `Delete "${currentWatchlist.name}"? This will remove the watchlist and its tracked symbols.`
  );

  if (!confirmed) return;

  try {
    setPageError("");

    await deleteWatchlist(
      currentWatchlist.id
    );

    const updatedWatchlists: Watchlist[] =
      await getWatchlists();

    setWatchlists(updatedWatchlists);

    if (updatedWatchlists.length === 0) {
      setSelectedWatchlist(null);
      setMarketData({});
      setSmartAnalysis({});
      return;
    }

    const nextWatchlist =
      updatedWatchlists[0];

    setSelectedWatchlist(
      nextWatchlist.id
    );

    await loadMarketData(
      nextWatchlist.symbols
    );
  } catch (error) {
    console.error(
      "Failed to delete watchlist:",
      error
    );

    setPageError(
      "Could not delete the watchlist. Please try again."
    );
  }
};

  const handleSelectWatchlist =
    async (id: number) => {
      setSelectedWatchlist(id);
      setMarketData({});
      setSmartAnalysis({});
      setMarketErrors({});

      const selected =
        watchlists.find(
          (watchlist) =>
            watchlist.id === id
        );

      if (selected) {
        await loadMarketData(
          selected.symbols
        );
      }
    };

  const handleAddSymbol = async () => {
    if (
      !symbol.trim() ||
      selectedWatchlist === null
    ) {
      return;
    }

    try {
      setPageError("");

      const stockSymbol = symbol
        .trim()
        .toUpperCase();

      await addSymbol(
        selectedWatchlist,
        stockSymbol
      );

      setSymbol("");

      const updatedWatchlists: Watchlist[] =
        await getWatchlists();

      setWatchlists(
        updatedWatchlists
      );

      const updatedWatchlist =
        updatedWatchlists.find(
          (watchlist) =>
            watchlist.id ===
            selectedWatchlist
        );

      if (updatedWatchlist) {
        await loadMarketData(
          updatedWatchlist.symbols
        );
      }
    } catch (error) {
      console.error(
        "Failed to add symbol:",
        error
      );

      setPageError(
        "Could not add this stock. Check the symbol and try again."
      );
    }
  };

  const handleRemoveSymbol =
    async (stock: string) => {
      if (selectedWatchlist === null)
        return;

      try {
        await removeSymbol(
          selectedWatchlist,
          stock
        );

        const updatedWatchlists: Watchlist[] =
          await getWatchlists();

        setWatchlists(
          updatedWatchlists
        );

        const updatedWatchlist =
          updatedWatchlists.find(
            (watchlist) =>
              watchlist.id ===
              selectedWatchlist
          );

        if (updatedWatchlist) {
          await loadMarketData(
            updatedWatchlist.symbols
          );
        }
      } catch (error) {
        console.error(
          "Failed to remove symbol:",
          error
        );

        setPageError(
          `Could not remove ${stock}.`
        );
      }
    };

  const handleRefreshMarketData =
    async () => {
      if (!currentWatchlist) return;

      await loadMarketData(
        currentWatchlist.symbols
      );
    };

  const handleMarkAsChecked =
    async (stock: string) => {
      const analysis =
        smartAnalysis[stock];

      if (!analysis) return;

      try {
        await saveSnapshot(
          stock,
          safeNumber(
            analysis.current.price
          ),
          safeNumber(
            analysis.attention
              .attention_score
          )
        );

        setSmartAnalysis((prev) => ({
          ...prev,

          [stock]: {
            ...prev[stock],

            since_last_checked: {
              previous_price:
                safeNumber(
                  analysis.current.price
                ),

              change_percent: 0,

              has_previous_snapshot:
                true,
            },
          },
        }));
      } catch (error) {
        console.error(
          `Failed to save snapshot for ${stock}:`,
          error
        );

        setPageError(
          `Could not save ${stock} as checked.`
        );
      }
    };

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 64px)",
        bgcolor: "background.default",
        py: { xs: 3, md: 5 },
      }}
    >
      <Box
        sx={{
          maxWidth: 1240,
          mx: "auto",
          px: { xs: 2, sm: 3, md: 4 },
        }}
      >
        {/* Page Header */}
        <Box sx={{ mb: 4 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: {
                xs: "flex-start",
                md: "center",
              },
              gap: 2,
              flexWrap: "wrap",
            }}
          >
            <Box>
              <Typography
                variant="h3"
                sx={{
                  fontWeight: 900,
                  letterSpacing:
                    "-0.04em",
                  fontSize: {
                    xs: "2rem",
                    md: "3rem",
                  },
                  color: "text.primary",
                }}
              >
                Your Watchlists
              </Typography>

              <Typography
                color="text.secondary"
                sx={{
                  mt: 0.75,
                  maxWidth: 700,
                }}
              >
                Track the market without
                drowning in noise. Your
                attention feed highlights
                what meaningfully changed.
              </Typography>
            </Box>

            {currentWatchlist && (
              <Button
                variant="outlined"
                startIcon={
                  <RefreshIcon />
                }
                onClick={
                  handleRefreshMarketData
                }
                disabled={
                  loadingMarketData
                }
                sx={{
                  borderRadius: 2,
                  fontWeight: 700,
                }}
              >
                {loadingMarketData
                  ? "Refreshing..."
                  : "Refresh Data"}
              </Button>
            )}
          </Box>
        </Box>

        {pageError && (
          <Alert
            severity="error"
            sx={{ mb: 3, borderRadius: 2 }}
            onClose={() =>
              setPageError("")
            }
          >
            {pageError}
          </Alert>
        )}

        {/* Watchlist Management */}
<Box sx={{ mb: 4 }}>
  {/* Create Watchlist */}
  <Card
    sx={{
      borderRadius: 3,
      border: "1px solid",
      borderColor: "divider",
      mb: 2,
    }}
  >
    <CardContent
      sx={{
        p: { xs: 2.5, md: 3 },
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
          mb: 1.5,
          flexWrap: "wrap",
        }}
      >
        <Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <AddIcon color="primary" />

            <Typography
              variant="h6"
              sx={{
                fontWeight: 900,
              }}
            >
              Create a watchlist
            </Typography>
          </Box>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.5,
            }}
          >
            Organize stocks into focused market views.
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          alignItems: "center",
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="e.g. My Portfolio"
          value={name}
          onChange={(e) =>
            setName(e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleCreateWatchlist();
            }
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
            },
          }}
        />

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateWatchlist}
          disabled={!name.trim()}
          sx={{
            minWidth: 125,
            height: 40,
            borderRadius: 2,
            fontWeight: 800,
            textTransform: "none",
            boxShadow: "none",
          }}
        >
          Create
        </Button>
      </Box>
    </CardContent>
  </Card>

  {/* Watchlist Selector */}
  {watchlists.length > 0 && (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 1.5,
        }}
      >
        <Box>
          <Typography
  variant="subtitle1"
  sx={{
    fontWeight: 900,
    color: "text.primary",
  }}
>
  Your watchlists
</Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            
          >
            Select a list to view its market signals.
          </Typography>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
        >
          {watchlists.length}{" "}
          {watchlists.length === 1
            ? "watchlist"
            : "watchlists"}
        </Typography>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(3, 1fr)",
          },
          gap: 1.5,
        }}
      >
        {watchlists.map(
          (watchlist: Watchlist) => {
            const isSelected =
              selectedWatchlist ===
              watchlist.id;

            return (
              <Card
                key={watchlist.id}
                onClick={() =>
                  handleSelectWatchlist(
                    watchlist.id
                  )
                }
                sx={{
                  cursor: "pointer",
                  borderRadius: 2.5,
                  border: "1px solid",
                  borderColor: isSelected
                    ? "primary.main"
                    : "divider",
                  bgcolor: isSelected
                    ? "rgba(25,118,210,0.04)"
                    : "background.paper",
                  boxShadow: isSelected
                    ? "0 4px 14px rgba(25,118,210,0.10)"
                    : "none",
                  transition:
                    "all 0.18s ease",
                  "&:hover": {
                    borderColor:
                      "primary.main",
                    transform:
                      "translateY(-1px)",
                  },
                }}
              >
                <CardContent
                  sx={{
                    p: 2,
                    "&:last-child": {
                      pb: 2,
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent:
                        "space-between",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <Box
                      sx={{
                        minWidth: 0,
                      }}
                    >
                      <Typography
                        variant="body1"
                        sx={{
                          fontWeight: 900,
                          overflow: "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {watchlist.name}
                      </Typography>

                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        {watchlist.symbols
                          ?.length ?? 0}{" "}
                        {watchlist.symbols
                          ?.length === 1
                          ? "stock"
                          : "stocks"}
                      </Typography>
                    </Box>

                    {isSelected && (
                      <Chip
                        size="small"
                        label="Selected"
                        color="primary"
                        sx={{
                          fontWeight: 800,
                        }}
                      />
                    )}
                  </Box>
                </CardContent>
              </Card>
            );
          }
        )}
      </Box>
    </Box>
  )}
</Box>
        {!currentWatchlist ? (
          <Card
            sx={{
              borderRadius: 3,
              textAlign: "center",
              py: 8,
            }}
          >
            <InsightsIcon
              sx={{
                fontSize: 56,
                color: "text.disabled",
                mb: 1,
              }}
            />

            <Typography
              variant="h6"
              sx={{ fontWeight: 800 }}
            >
              No watchlist selected
            </Typography>

            <Typography
              color="text.secondary"
              sx={{ mt: 1 }}
            >
              Create a watchlist above
              to begin tracking stocks.
            </Typography>
          </Card>
        ) : (
          <>
            {/* Watchlist Header */}
            <Card
              sx={{
                mb: 3,
                borderRadius: 3,
                border: "1px solid",
                borderColor: "divider",
              }}
            >
              <CardContent
  sx={{
    p: { xs: 2.5, md: 3 },
  }}
>
  <Box
    sx={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 2,
      flexWrap: "wrap",
    }}
  >
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography
          variant="h5"
          sx={{
            fontWeight: 900,
            letterSpacing: "-0.02em",
          }}
        >
          {currentWatchlist.name}
        </Typography>

        <Chip
          size="small"
          label={`${currentWatchlist.symbols.length} ${
            currentWatchlist.symbols.length === 1
              ? "stock"
              : "stocks"
          }`}
          variant="outlined"
          sx={{
            fontWeight: 700,
          }}
        />
      </Box>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          mt: 0.5,
        }}
      >
        Smart attention signals for this
        watchlist.
      </Typography>
    </Box>

    <Button
      color="error"
      variant="outlined"
      startIcon={<DeleteIcon />}
      onClick={handleDeleteWatchlist}
      sx={{
        borderRadius: 2,
        fontWeight: 800,
        textTransform: "none",
      }}
    >
      Delete
    </Button>
  </Box>

  <Divider sx={{ my: 2.5 }} />

  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      flexWrap: "wrap",
    }}
  >
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        fontWeight: 700,
        mr: 0.5,
      }}
    >
      Attention status
    </Typography>

    <Chip
      size="small"
      icon={<WarningAmberIcon />}
      label={`${highAttentionCount} high`}
      color="error"
      variant="outlined"
    />

    <Chip
      size="small"
      label={`${mediumAttentionCount} medium`}
      color="warning"
      variant="outlined"
    />

    <Chip
      size="small"
      icon={<CheckCircleIcon />}
      label={`${Math.max(
        attentionStocks.length -
          highAttentionCount -
          mediumAttentionCount,
        0
      )} normal`}
      color="success"
      variant="outlined"
    />
  </Box>

  <Box
    sx={{
      display: "flex",
      gap: 1.5,
      mt: 2.5,
    }}
  >
    <TextField
      fullWidth
      size="small"
      label="Add stock symbol"
      placeholder="AAPL, IBM, RELIANCE"
      value={symbol}
      onChange={(e) =>
        setSymbol(
          e.target.value.toUpperCase()
        )
      }
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          handleAddSymbol();
        }
      }}
      sx={{
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
        },
      }}
    />

    <Button
      variant="contained"
      startIcon={<AddIcon />}
      onClick={handleAddSymbol}
      disabled={
        !symbol.trim() ||
        selectedWatchlist === null
      }
      sx={{
        minWidth: 100,
        borderRadius: 2,
        fontWeight: 800,
        textTransform: "none",
        boxShadow: "none",
      }}
    >
      Add
    </Button>
  </Box>
</CardContent>
            </Card>

            {/* Attention Section */}
            <Box sx={{ mb: 4 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "flex-end",
                  gap: 2,
                  mb: 2,
                  flexWrap: "wrap",
                }}
              >
                <Box>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <InsightsIcon
                      color="primary"
                    />

                    <Typography
  variant="h5"
  sx={{
    fontWeight: 900,
    color: "text.primary",
  }}
>
  What Deserves Attention
</Typography>
                  </Box>

                  <Typography
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    Ranked by your smart
                    attention score — not
                    simply by price movement.
                  </Typography>
                </Box>

                {meaningfulAttentionStocks.length >
                  0 && (
                  <Chip
                    label={`${meaningfulAttentionStocks.length} meaningful signal${
                      meaningfulAttentionStocks.length ===
                      1
                        ? ""
                        : "s"
                    }`}
                    color="warning"
                    sx={{
                      fontWeight: 800,
                    }}
                  />
                )}
              </Box>

              {loadingMarketData &&
              attentionStocks.length ===
                0 ? (
                <Card
                  sx={{
                    borderRadius: 3,
                    py: 7,
                    textAlign: "center",
                  }}
                >
                  <CircularProgress />

                  <Typography
                    sx={{
                      mt: 2,
                      fontWeight: 700,
                    }}
                  >
                    Analyzing your
                    watchlist...
                  </Typography>

                  <Typography
                    color="text.secondary"
                    variant="body2"
                    sx={{ mt: 0.5 }}
                  >
                    Checking price,
                    volume, 52-week levels
                    and market-relative
                    movement.
                  </Typography>
                </Card>
              ) : attentionStocks.length ===
                0 ? (
                <Card
                  sx={{
                    borderRadius: 3,
                    border: "1px solid",
                    borderColor:
                      "success.light",
                    bgcolor:
                      "rgba(46,125,50,0.035)",
                  }}
                >
                  <CardContent
                    sx={{
                      py: 6,
                      textAlign: "center",
                    }}
                  >
                    <CheckCircleIcon
                      color="success"
                      sx={{
                        fontSize: 52,
                        mb: 1,
                      }}
                    />

                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 900 }}
                    >
                      No smart analysis
                      signals yet
                    </Typography>

                    <Typography
                      color="text.secondary"
                      sx={{
                        mt: 0.75,
                      }}
                    >
                      Add stocks with
                      enough market history
                      to calculate
                      meaningful changes.
                    </Typography>
                  </CardContent>
                </Card>
              ) : (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      lg: "repeat(2, 1fr)",
                    },
                    gap: 2.5,
                  }}
                >
                  {attentionStocks.map(
                    (stock) => (
                      <AttentionCard
                        key={stock}
                        analysis={
                          smartAnalysis[
                            stock
                          ]
                        }
                        onCheck={
                          handleMarkAsChecked
                        }
                      />
                    )
                  )}
                </Box>
              )}
            </Box>

            {/* All Stocks */}
            <Box>
              <Box
  sx={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    mb: 2,
  }}
>
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
    }}
  >
    <ShowChartIcon color="primary" />

    <Box>
      <Typography
  variant="h5"
  sx={{
    fontWeight: 900,
    lineHeight: 1.1,
    color: "text.primary",
  }}
>
  All Tracked Stocks
</Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5 }}
      >
        Your complete watchlist at a glance
      </Typography>
    </Box>
  </Box>

  <Typography
    variant="body2"
    color="text.secondary"
    sx={{ fontWeight: 700 }}
  >
    {currentWatchlist.symbols.length} stocks
  </Typography>
</Box>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "repeat(2, 1fr)",
                    xl: "repeat(3, 1fr)",
                  },
                  gap: 2,
                }}
              >
                {currentWatchlist.symbols.map(
                  (stock) => {
                    const quote =
                      marketData[stock];

                    const analysis =
                      smartAnalysis[
                        stock
                      ];

                    const error =
                      marketErrors[
                        stock
                      ];

                    const score =
                      analysis
                        ? safeNumber(
                            analysis
                              .attention
                              .attention_score
                          )
                        : 0;

                    return (
                      <Card
  key={stock}
  sx={{
  borderRadius: 3,
  border: "1px solid #e1e7ef",
  backgroundColor: "#ffffff",
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
  transition: "transform 0.2s ease, box-shadow 0.2s ease",
  "&:hover": {
    transform: "translateY(-3px)",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
  },
}}
>
                        <CardContent
  sx={{
    p: 2,
    "&:last-child": {
      pb: 2,
    },
  }}
>
                          <Box
                            sx={{
                              display:
                                "flex",
                              justifyContent:
                                "space-between",
                              alignItems:
                                "flex-start",
                              gap: 1,
                            }}
                          >
                            <Box>
                              <Typography
  variant="h6"
  sx={{
    fontWeight: 900,
    fontSize: "1.15rem",
    color: "#102a56",
    letterSpacing: "-0.02em",
  }}
>
  {stock}
</Typography>

                              {quote ? (
                                <Typography
  variant="h6"
  sx={{
  fontWeight: 900,
  fontSize: "1.35rem",
  color: "#102a56",
}}
>
                                  {formatCurrency(
                                    quote.price
                                  )}
                                </Typography>
                              ) : (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{
                                    mt: 0.5,
                                  }}
                                >
                                  Data unavailable
                                </Typography>
                              )}
                            </Box>

                            <IconButton
  size="small"
  onClick={() =>
    handleRemoveSymbol(stock)
  }
  aria-label={`Remove ${stock}`}
  sx={{
    color: "text.secondary",
    border: "1px solid",
    borderColor: "divider",
    width: 34,
    height: 34,
    "&:hover": {
      color: "error.main",
      borderColor: "error.light",
      bgcolor: "error.50",
    },
  }}
>
  <DeleteIcon fontSize="small" />
</IconButton>
                          </Box>

                          {error && (
                            <Alert
                              severity="warning"
                              icon={
                                <WarningAmberIcon />
                              }
                              sx={{
                                mt: 2,
                                borderRadius: 2,
                                fontSize:
                                  "0.8rem",
                              }}
                            >
                              {error}
                            </Alert>
                          )}

                          {quote && (
                            <>
                              <Box
  sx={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 1,
    mt: 1.25,
    flexWrap: "wrap",
  }}
>
                                <Chip
  size="small"
  label={formatPercent(
    quote.change_percent
  )}
  sx={{
  fontWeight: 900,
  height: 28,
  px: 1,
  borderRadius: 1.5,
}}
                                  color={
                                    safeNumber(
                                      quote.change
                                    ) >= 0
                                      ? "success"
                                      : "error"
                                  }
                                  variant="outlined"
                                />

                                <Typography
  variant="caption"
  sx={{
    color: "text.primary",
    fontWeight: 700,
  }}
>
  Volume{" "}
  {formatNumber(
    quote.volume
  )}
</Typography>
                              </Box>

                              <Divider
  sx={{
    my: 1.5,
  }}
/>

                              <Box
                                sx={{
                                  display:
                                    "flex",
                                  justifyContent:
                                    "space-between",
                                  alignItems:
                                    "center",
                                }}
                              >
                                <Box
                                  sx={{
                                    display:
                                      "flex",
                                    alignItems:
                                      "center",
                                    gap: 0.75,
                                  }}
                                >
                                  <InsightsIcon
                                    fontSize="small"
                                    color="primary"
                                  />

                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontWeight: 700,
                                    }}
                                  >
                                    Attention
                                  </Typography>
                                </Box>

                                {analysis ? (
                                  <Chip
                                    size="small"
                                    label={`${score}/100`}
                                    color={getSeverityColor(
                                      analysis
                                        .attention
                                        .severity
                                    )}
                                    sx={{
                                      fontWeight: 800,
                                    }}
                                  />
                                ) : (
                                  <Chip
                                    size="small"
                                    label="—"
                                  />
                                )}
                              </Box>

                              {analysis && (
                                <LinearProgress
                                  variant="determinate"
                                  value={Math.min(
                                    score,
                                    100
                                  )}
                                  color={getScoreColor(
                                    score
                                  )}
                                  sx={{
  mt: 1,
  height: 7,
  borderRadius: 5,
  backgroundColor: "rgba(25, 118, 210, 0.08)",
}}
                                />
                              )}

                              <Box
  sx={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 1,
    mt: 1.25,
    pt: 1,
    borderTop: "1px solid",
    borderColor: "divider",
  }}
>
                                <AccessTimeIcon
  fontSize="small"
  sx={{
    color: "text.secondary",
  }}
/>

                                <Typography
  variant="caption"
  sx={{
    color: "text.primary",
    fontWeight: 700,
  }}
>
  {quote.latest_trading_day}
</Typography>
                              </Box>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    );
                  }
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}