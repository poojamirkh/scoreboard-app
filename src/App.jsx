import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import {
  Trophy,
  Monitor,
  RotateCcw,
  Search,
  Users,
  Medal,
  UserPlus,
  Settings,
  Presentation,
  Maximize2,
  Minimize2,
} from "lucide-react";

const EVENTS = ["Darts", "Axe Throwing", "Long Drive", "Batting Cages"];

const EVENT_KEY_MAP = {
  Darts: "darts",
  "Axe Throwing": "axe",
  "Long Drive": "long_drive",
  "Batting Cages": "batting",
};

const EMPTY_SCORE_MAP = {
  Darts: "",
  "Axe Throwing": "",
  "Long Drive": "",
  "Batting Cages": "",
};

function createPlayerCode() {
  return `P-${Math.floor(100000 + Math.random() * 900000)}`;
}

function getNumericScore(value) {
  if (value === "" || value === undefined || value === null) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function StatCard({ label, value, icon }) {
  return (
    <div style={styles.card}>
      <div>
        <div style={styles.statLabel}>{label}</div>
        <div style={styles.statValue}>{value}</div>
      </div>
      <div style={styles.iconWrap}>{icon}</div>
    </div>
  );
}

export default function App() {
  const [players, setPlayers] = useState([]);
  const [playerName, setPlayerName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState("Darts");
  const [activeTab, setActiveTab] = useState("admin");
  const [eventIdMap, setEventIdMap] = useState({});
  const [isResetting, setIsResetting] = useState(false);
  const [isProjectionFullscreen, setIsProjectionFullscreen] = useState(false);

  const projectionRef = useRef(null);

  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("events")
      .select("id, key, label");

    if (error) {
      console.error("LOAD EVENTS ERROR:", error);
      return;
    }

    const map = {};
    (data || []).forEach((eventRow) => {
      map[eventRow.key] = eventRow.id;
    });

    setEventIdMap(map);
  }, []);

  const loadPlayers = useCallback(async () => {
    if (Object.keys(eventIdMap).length === 0) return;

    const { data, error } = await supabase
      .from("players")
      .select("id, name, player_code, scores(score, event_id)")
      .order("checked_in_at", { ascending: true });

    if (error) {
      console.error("LOAD PLAYERS ERROR:", error);
      return;
    }

    const formattedPlayers = (data || []).map((player) => {
      const scoreMap = { ...EMPTY_SCORE_MAP };

      (player.scores || []).forEach((scoreRow) => {
        const eventKey = Object.keys(eventIdMap).find(
          (key) => eventIdMap[key] === scoreRow.event_id
        );

        if (!eventKey) return;

        const eventLabel = Object.keys(EVENT_KEY_MAP).find(
          (label) => EVENT_KEY_MAP[label] === eventKey
        );

        if (!eventLabel) return;

        scoreMap[eventLabel] = String(scoreRow.score ?? "");
      });

      return {
        id: player.id,
        name: player.name ?? "",
        playerId: player.player_code ?? "",
        scores: scoreMap,
      };
    });

    setPlayers(formattedPlayers);
  }, [eventIdMap]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (Object.keys(eventIdMap).length === 0) return;

    loadPlayers();

    const channel = supabase
      .channel("live-scoreboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        () => {
          loadPlayers();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        () => {
          loadPlayers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventIdMap, loadPlayers]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsProjectionFullscreen(document.fullscreenElement === projectionRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleProjectionFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await projectionRef.current?.requestFullscreen();
      } else if (document.fullscreenElement === projectionRef.current) {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("FULLSCREEN ERROR:", error);
    }
  };

  const checkedInCount = players.length;

  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return players;

    return players.filter((player) => {
      const safeName = (player.name || "").toLowerCase();
      const safePlayerId = (player.playerId || "").toLowerCase();

      return safeName.includes(query) || safePlayerId.includes(query);
    });
  }, [players, search]);

  const leaderboard = useMemo(() => {
    return [...players]
      .map((player) => {
        const total = EVENTS.reduce((sum, eventName) => {
          return sum + getNumericScore(player.scores?.[eventName]);
        }, 0);

        return {
          ...player,
          total,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [players]);

  const addPlayer = async () => {
    const cleanName = playerName.trim();
    if (!cleanName) return;

    const { error } = await supabase.from("players").insert([
      {
        name: cleanName,
        player_code: createPlayerCode(),
      },
    ]);

    if (error) {
      console.error("ADD PLAYER ERROR:", error);
      return;
    }

    setPlayerName("");
    await loadPlayers();
  };

  const updateScore = async (playerId, eventName, value) => {
    if (value !== "" && !/^\d*$/.test(value)) return;

    const eventKey = EVENT_KEY_MAP[eventName];
    const eventId = eventIdMap[eventKey];

    if (!eventId) {
      console.error("MISSING EVENT ID FOR:", eventName, eventKey);
      return;
    }

    const numericScore = value === "" ? 0 : Number(value);

    const { error } = await supabase.from("scores").upsert(
      [
        {
          player_id: playerId,
          event_id: eventId,
          score: numericScore,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "player_id,event_id" }
    );

    if (error) {
      console.error("UPDATE SCORE ERROR:", error);
      return;
    }

    setPlayers((prev) =>
      prev.map((player) =>
        player.id === playerId
          ? {
              ...player,
              scores: {
                ...player.scores,
                [eventName]: String(value),
              },
            }
          : player
      )
    );
  };

  const resetAll = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to reset all players and scores? This clears the whole event."
    );
    if (!confirmed) return;

    setIsResetting(true);

    const { error: scoresError } = await supabase
      .from("scores")
      .delete()
      .not("id", "is", null);

    if (scoresError) {
      console.error("RESET SCORES ERROR:", scoresError);
      setIsResetting(false);
      return;
    }

    const { error: playersError } = await supabase
      .from("players")
      .delete()
      .not("id", "is", null);

    if (playersError) {
      console.error("RESET PLAYERS ERROR:", playersError);
      setIsResetting(false);
      return;
    }

    setPlayers([]);
    setPlayerName("");
    setSearch("");
    setSelectedEvent("Darts");
    setActiveTab("admin");
    setIsResetting(false);
  };

  const currentLeader = leaderboard[0];

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.pill}>
              <Monitor size={16} />
              <span>Live Individual Scoring</span>
            </div>
            <h1 style={styles.title}>Player Check-In & Scoreboard</h1>
            <p style={styles.subtitle}>
              Check players in, auto-assign player IDs, update scores by event,
              and switch to a projector-friendly leaderboard view.
            </p>
          </div>

          <button
            onClick={resetAll}
            style={styles.resetButton}
            disabled={isResetting}
          >
            <RotateCcw size={16} />
            <span>{isResetting ? "Resetting..." : "Reset All"}</span>
          </button>
        </div>

        <div style={styles.tabRow}>
          <button
            onClick={() => setActiveTab("admin")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "admin" ? styles.activeTabButton : {}),
            }}
          >
            <Settings size={16} />
            <span>Admin / Scoring</span>
          </button>

          <button
            onClick={() => setActiveTab("projection")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "projection" ? styles.activeTabButton : {}),
            }}
          >
            <Presentation size={16} />
            <span>Projection Leaderboard</span>
          </button>
        </div>

        {activeTab === "admin" ? (
          <>
            <div style={styles.statsGrid}>
              <StatCard
                label="Checked In"
                value={checkedInCount}
                icon={<Users size={24} />}
              />
              <StatCard
                label="Events"
                value={EVENTS.length}
                icon={<Medal size={24} />}
              />

              <div style={{ ...styles.card, gridColumn: "span 2" }}>
                <div>
                  <div style={styles.statLabel}>Current Leader</div>
                  <div style={{ ...styles.statValue, fontSize: 24 }}>
                    {currentLeader?.name || "—"}
                  </div>
                  <div style={styles.muted}>
                    {currentLeader?.playerId || "No players yet"}
                  </div>
                </div>
                <div style={styles.scoreBadge}>
                  {currentLeader?.total ?? 0} pts
                </div>
              </div>
            </div>

            <div style={styles.mainGrid}>
              <div style={styles.leftColumn}>
                <div style={styles.panel}>
                  <h2 style={styles.panelTitle}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <UserPlus size={18} /> Player Check-In
                    </span>
                  </h2>

                  <div style={styles.checkInRow}>
                    <input
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addPlayer();
                      }}
                      placeholder="Enter player name"
                      style={styles.input}
                    />
                    <button onClick={addPlayer} style={styles.primaryButton}>
                      Check In Player
                    </button>
                  </div>

                  <div style={styles.helperText}>
                    Each checked-in player automatically gets a unique player ID.
                  </div>
                </div>

                <div style={styles.panel}>
                  <h2 style={styles.panelTitle}>Score Entry</h2>

                  <div style={styles.controlsGrid}>
                    <div>
                      <label style={styles.label}>Find Player</label>
                      <div style={styles.searchWrap}>
                        <Search size={16} style={styles.searchIcon} />
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search by name or player ID"
                          style={styles.inputWithIcon}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={styles.label}>Event</label>
                      <select
                        value={selectedEvent}
                        onChange={(e) => setSelectedEvent(e.target.value)}
                        style={styles.select}
                      >
                        {EVENTS.map((event) => (
                          <option key={event} value={event}>
                            {event}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Player</th>
                          <th style={styles.th}>Player ID</th>
                          <th style={styles.th}>{selectedEvent} Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlayers.length === 0 ? (
                          <tr>
                            <td colSpan="3" style={styles.emptyState}>
                              No players checked in yet.
                            </td>
                          </tr>
                        ) : (
                          filteredPlayers.map((player) => (
                            <tr key={player.id}>
                              <td style={styles.tdStrong}>{player.name}</td>
                              <td style={styles.td}>{player.playerId}</td>
                              <td style={styles.td}>
                                <input
                                  value={player.scores?.[selectedEvent] ?? ""}
                                  onChange={(e) =>
                                    updateScore(
                                      player.id,
                                      selectedEvent,
                                      e.target.value
                                    )
                                  }
                                  placeholder="0"
                                  style={styles.input}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div style={styles.panel}>
                <h2 style={styles.panelTitle}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Trophy size={18} /> Individual Leaderboard
                  </span>
                </h2>

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Rank</th>
                        <th style={styles.th}>Player</th>
                        <th style={styles.th}>Player ID</th>
                        <th style={styles.th}>Darts</th>
                        <th style={styles.th}>Axe Throwing</th>
                        <th style={styles.th}>Long Drive</th>
                        <th style={styles.th}>Batting Cages</th>
                        <th style={styles.th}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.length === 0 ? (
                        <tr>
                          <td colSpan="8" style={styles.emptyState}>
                            No players checked in yet.
                          </td>
                        </tr>
                      ) : (
                        leaderboard.map((player, index) => (
                          <tr key={player.id}>
                            <td style={styles.td}>{index + 1}</td>
                            <td style={styles.tdStrong}>{player.name}</td>
                            <td style={styles.td}>{player.playerId}</td>
                            <td style={styles.td}>
                              {getNumericScore(player.scores?.Darts)}
                            </td>
                            <td style={styles.td}>
                              {getNumericScore(
                                player.scores?.["Axe Throwing"]
                              )}
                            </td>
                            <td style={styles.td}>
                              {getNumericScore(player.scores?.["Long Drive"])}
                            </td>
                            <td style={styles.td}>
                              {getNumericScore(
                                player.scores?.["Batting Cages"]
                              )}
                            </td>
                            <td style={styles.tdStrong}>{player.total}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            ref={projectionRef}
            style={{
              ...styles.projectionScreen,
              ...(isProjectionFullscreen ? styles.projectionScreenFullscreen : {}),
            }}
          >
            <div style={styles.projectionHeader}>
              <div>
                <div style={styles.projectionEyebrow}>
                  Projection Leaderboard
                </div>
                <h2 style={styles.projectionTitle}>Live Standings</h2>
              </div>

              <div style={styles.projectionHeaderRight}>
                <div style={styles.projectionMeta}>
                  <span>{players.length} Players</span>
                  <span>{EVENTS.length} Events</span>
                </div>

                <button
                  onClick={toggleProjectionFullscreen}
                  style={styles.fullscreenButton}
                >
                  {isProjectionFullscreen ? (
                    <>
                      <Minimize2 size={18} />
                      <span>Exit Full Screen</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 size={18} />
                      <span>Full Screen</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {leaderboard.length === 0 ? (
              <div style={styles.projectionEmpty}>No players checked in yet.</div>
            ) : (
              <div style={styles.projectionTableWrap}>
                <table style={styles.projectionTable}>
                  <thead>
                    <tr>
                      <th style={styles.projectionTh}>Rank</th>
                      <th style={styles.projectionTh}>Player</th>
                      <th style={styles.projectionTh}>ID</th>
                      <th style={styles.projectionTh}>Darts</th>
                      <th style={styles.projectionTh}>Axe Throwing</th>
                      <th style={styles.projectionTh}>Long Drive</th>
                      <th style={styles.projectionTh}>Batting Cages</th>
                      <th style={styles.projectionTh}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((player, index) => (
                      <tr
                        key={player.id}
                        style={index === 0 ? styles.firstPlaceRow : undefined}
                      >
                        <td style={styles.projectionTd}>{index + 1}</td>
                        <td style={styles.projectionTdStrong}>{player.name}</td>
                        <td style={styles.projectionTd}>{player.playerId}</td>
                        <td style={styles.projectionTd}>
                          {getNumericScore(player.scores?.Darts)}
                        </td>
                        <td style={styles.projectionTd}>
                          {getNumericScore(player.scores?.["Axe Throwing"])}
                        </td>
                        <td style={styles.projectionTd}>
                          {getNumericScore(player.scores?.["Long Drive"])}
                        </td>
                        <td style={styles.projectionTd}>
                          {getNumericScore(player.scores?.["Batting Cages"])}
                        </td>
                        <td style={styles.projectionTdStrong}>{player.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: "24px",
    fontFamily: "Arial, sans-serif",
    color: "#0f172a",
  },
  container: {
    maxWidth: "1280px",
    margin: "0 auto",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "flex-start",
    marginBottom: "20px",
    flexWrap: "wrap",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "14px",
    marginBottom: "12px",
  },
  title: {
    fontSize: "36px",
    margin: "0 0 8px 0",
  },
  subtitle: {
    margin: 0,
    color: "#475569",
    maxWidth: "860px",
  },
  tabRow: {
    display: "flex",
    gap: "12px",
    marginBottom: "24px",
    flexWrap: "wrap",
  },
  tabButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    border: "1px solid #cbd5e1",
    background: "white",
    borderRadius: "14px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 600,
    color: "#334155",
  },
  activeTabButton: {
    background: "#0f172a",
    color: "white",
    border: "1px solid #0f172a",
  },
  resetButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    border: "1px solid #cbd5e1",
    background: "white",
    borderRadius: "14px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 600,
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "#0f172a",
    color: "white",
    borderRadius: "14px",
    padding: "12px 16px",
    cursor: "pointer",
    fontWeight: 600,
    minWidth: "170px",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "16px",
    marginBottom: "24px",
  },
  card: {
    background: "white",
    borderRadius: "18px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    minHeight: "108px",
  },
  iconWrap: {
    background: "#f1f5f9",
    borderRadius: "16px",
    padding: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    color: "#64748b",
    fontSize: "14px",
    marginBottom: "6px",
  },
  statValue: {
    fontSize: "32px",
    fontWeight: 700,
  },
  muted: {
    color: "#64748b",
    marginTop: "6px",
  },
  scoreBadge: {
    background: "#0f172a",
    color: "white",
    borderRadius: "999px",
    padding: "10px 14px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "1.2fr 0.95fr",
    gap: "24px",
    alignItems: "start",
  },
  leftColumn: {
    display: "grid",
    gap: "24px",
  },
  panel: {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "20px",
  },
  panelTitle: {
    marginTop: 0,
    marginBottom: "20px",
    fontSize: "22px",
  },
  checkInRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "12px",
  },
  helperText: {
    marginTop: "12px",
    color: "#64748b",
    fontSize: "14px",
  },
  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 220px",
    gap: "16px",
    marginBottom: "20px",
  },
  label: {
    display: "block",
    marginBottom: "8px",
    fontWeight: 600,
    fontSize: "14px",
  },
  searchWrap: {
    position: "relative",
  },
  searchIcon: {
    position: "absolute",
    left: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#94a3b8",
  },
  inputWithIcon: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "10px 12px 10px 36px",
    fontSize: "14px",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "14px",
  },
  select: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    padding: "10px 12px",
    fontSize: "14px",
    background: "white",
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: "14px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: "14px",
    background: "#f8fafc",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "14px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: "14px",
  },
  tdStrong: {
    padding: "14px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: "14px",
    fontWeight: 600,
  },
  emptyState: {
    padding: "24px",
    textAlign: "center",
    color: "#64748b",
    fontSize: "14px",
  },
  projectionScreen: {
    background: "#0f172a",
    color: "white",
    borderRadius: "24px",
    padding: "28px",
    minHeight: "70vh",
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.25)",
  },
  projectionScreenFullscreen: {
    width: "100%",
    height: "100%",
    minHeight: "100vh",
    borderRadius: 0,
    padding: "32px",
    overflow: "auto",
  },
  projectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "16px",
    marginBottom: "24px",
    flexWrap: "wrap",
  },
  projectionHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  projectionEyebrow: {
    fontSize: "14px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#94a3b8",
    marginBottom: "8px",
  },
  projectionTitle: {
    margin: 0,
    fontSize: "42px",
  },
  projectionMeta: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    color: "#cbd5e1",
    fontSize: "16px",
    fontWeight: 600,
  },
  fullscreenButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    borderRadius: "14px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  projectionEmpty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "50vh",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "20px",
    color: "#cbd5e1",
    fontSize: "22px",
  },
  projectionTableWrap: {
    overflowX: "auto",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "20px",
    background: "rgba(255,255,255,0.04)",
  },
  projectionTable: {
    width: "100%",
    borderCollapse: "collapse",
  },
  projectionTh: {
    textAlign: "left",
    padding: "18px 16px",
    fontSize: "15px",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
    color: "#cbd5e1",
    whiteSpace: "nowrap",
  },
  projectionTd: {
    padding: "18px 16px",
    fontSize: "22px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
  },
  projectionTdStrong: {
    padding: "18px 16px",
    fontSize: "24px",
    fontWeight: 700,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
  },
  firstPlaceRow: {
    background: "rgba(255,255,255,0.08)",
  },
};