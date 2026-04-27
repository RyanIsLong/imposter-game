import { useState, useEffect, useRef } from "react";

// ─── TOPIC POOL ────────────────────────────────────────────────────────────
// Each entry: [real word, imposter word]. Imposter word is similar but distinct.
const TOPIC_POOL = [
  ["Pizza", "Pancake"],
  ["Lion", "Tiger"],
  ["Guitar", "Violin"],
  ["Beach", "Desert"],
  ["Castle", "Cathedral"],
  ["Submarine", "Whale"],
  ["Astronaut", "Diver"],
  ["Volcano", "Mountain"],
  ["Bicycle", "Motorcycle"],
  ["Robot", "Knight"],
  ["Octopus", "Spider"],
  ["Dragon", "Dinosaur"],
  ["Snowman", "Scarecrow"],
  ["Lighthouse", "Windmill"],
  ["Cactus", "Pinecone"],
  ["Hamburger", "Sandwich"],
  ["Wizard", "Witch"],
  ["Helicopter", "Airplane"],
  ["Sushi", "Taco"],
  ["Vampire", "Zombie"],
  ["Mermaid", "Fairy"],
  ["Telescope", "Microscope"],
  ["Pirate", "Ninja"],
  ["Donut", "Bagel"],
  ["Tornado", "Hurricane"],
];

// ─── PHASES ────────────────────────────────────────────────────────────────
// setup → reveal → handoff → drawing → roundEnd → discussion → vote → results
const PHASES = {
  SETUP: "setup",
  REVEAL: "reveal",
  HANDOFF: "handoff",
  DRAWING: "drawing",
  ROUND_END: "roundEnd",
  GALLERY: "gallery",
  DISCUSSION: "discussion",
  VOTE: "vote",
  RESULTS: "results",
};

const DRAW_SECONDS = 30;
const HANDOFF_SECONDS = 4;
const DISCUSSION_SECONDS = 60;
const TOTAL_ROUNDS = 4;

// ─── AUDIO ────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  // browsers suspend audio until a user gesture; resume if needed
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTick(urgent = false) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  // urgent ticks are higher pitch and louder
  osc.frequency.value = urgent ? 880 : 600;
  osc.type = "square";

  const now = ctx.currentTime;
  const peak = urgent ? 0.15 : 0.08;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  osc.start(now);
  osc.stop(now + 0.06);
}

function playFinalBeep() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 220;
  osc.type = "sawtooth";
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.start(now);
  osc.stop(now + 0.4);
}

export default function App() {
  const [phase, setPhase] = useState(PHASES.SETUP);
  const [playerCount, setPlayerCount] = useState(4);
  const [topics, setTopics] = useState([]); // [[real, imposter], ...] one per round
  const [imposterIdx, setImposterIdx] = useState(null);
  const [revealed, setRevealed] = useState([]); // booleans per player
  const [currentDrawer, setCurrentDrawer] = useState(0);
  const [round, setRound] = useState(1);
  const [drawings, setDrawings] = useState([]); // {round, player, dataUrl}[]
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [votes, setVotes] = useState({}); // {voterIdx: votedForIdx}
  const [revealStep, setRevealStep] = useState("locked"); // locked | shown
  const [showRevealCard, setShowRevealCard] = useState(false);

  // ─── START GAME ─────────────────────────────────────────────────────────
  function startGame() {
    // Pick TOTAL_ROUNDS distinct topics in a random order
    const shuffled = [...TOPIC_POOL].sort(() => Math.random() - 0.5);
    const roundTopics = shuffled.slice(0, TOTAL_ROUNDS);
    const imp = Math.floor(Math.random() * playerCount);
    setTopics(roundTopics);
    setImposterIdx(imp);
    setRevealed(Array(playerCount).fill(false));
    setCurrentDrawer(0);
    setRound(1);
    setDrawings([]);
    setVotes({});
    setPhase(PHASES.REVEAL);
  }

  function resetAll() {
    setPhase(PHASES.SETUP);
    setTopics([]);
    setImposterIdx(null);
    setRevealed([]);
    setCurrentDrawer(0);
    setRound(1);
    setDrawings([]);
    setVotes({});
    setShowRevealCard(false);
  }

  // ─── REVEAL FLOW ────────────────────────────────────────────────────────
  function openRevealCard(idx) {
    if (revealed[idx]) return;
    setShowRevealCard(idx);
    setRevealStep("locked");
  }

  function unlockReveal() {
    setRevealStep("shown");
  }

  function closeReveal() {
    const idx = showRevealCard;
    const newRevealed = [...revealed];
    newRevealed[idx] = true;
    setRevealed(newRevealed);
    setShowRevealCard(false);
    setRevealStep("locked");
    if (newRevealed.every(Boolean)) {
      // all revealed — go to handoff for player 1
      setCurrentDrawer(0);
      setPhase(PHASES.HANDOFF);
    }
  }

  // ─── DRAWING FLOW ───────────────────────────────────────────────────────
  function onDrawingComplete(dataUrl) {
    setDrawings((prev) => [
      ...prev,
      { round, player: currentDrawer, dataUrl },
    ]);
    if (currentDrawer + 1 < playerCount) {
      setCurrentDrawer(currentDrawer + 1);
      setPhase(PHASES.HANDOFF);
    } else {
      // round complete
      setPhase(PHASES.ROUND_END);
    }
  }

  function startGallery() {
    setGalleryIdx(0);
    setPhase(PHASES.GALLERY);
  }

  function nextGalleryOrDiscussion() {
    const roundDrawings = drawings.filter((d) => d.round === round);
    if (galleryIdx + 1 < roundDrawings.length) {
      setGalleryIdx(galleryIdx + 1);
    } else {
      setPhase(PHASES.DISCUSSION);
    }
  }

  function endDiscussion() {
    if (round >= TOTAL_ROUNDS) {
      setPhase(PHASES.VOTE);
    } else {
      setRound(round + 1);
      setCurrentDrawer(0);
      // reset reveal state so each player must peek at the new word
      setRevealed(Array(playerCount).fill(false));
      setPhase(PHASES.REVEAL);
    }
  }

  function castVote(voterIdx, votedForIdx) {
    const newVotes = { ...votes, [voterIdx]: votedForIdx };
    setVotes(newVotes);
    if (Object.keys(newVotes).length === playerCount) {
      setPhase(PHASES.RESULTS);
    }
  }

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full text-stone-100 relative overflow-hidden" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", backgroundColor: "#0c0a14" }}>
      {/* atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at top left, rgba(244, 114, 182, 0.15), transparent 50%), radial-gradient(ellipse at bottom right, rgba(99, 102, 241, 0.18), transparent 55%)" }} />
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" }} />
      </div>

      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@500;700&display=swap" />

      <div className="relative z-10 max-w-2xl mx-auto px-5 py-8">
        {phase === PHASES.SETUP && <SetupScreen playerCount={playerCount} setPlayerCount={setPlayerCount} startGame={startGame} />}

        {phase === PHASES.REVEAL && (
          <RevealScreen
            playerCount={playerCount}
            revealed={revealed}
            openRevealCard={openRevealCard}
            showRevealCard={showRevealCard}
            revealStep={revealStep}
            unlockReveal={unlockReveal}
            closeReveal={closeReveal}
            isImposter={showRevealCard !== false && showRevealCard === imposterIdx}
            topic={topics[round - 1]}
            round={round}
            totalRounds={TOTAL_ROUNDS}
          />
        )}

        {phase === PHASES.HANDOFF && (
          <HandoffScreen
            playerNumber={currentDrawer + 1}
            round={round}
            totalRounds={TOTAL_ROUNDS}
            onReady={() => setPhase(PHASES.DRAWING)}
          />
        )}

        {phase === PHASES.DRAWING && (
          <DrawingScreen
            playerNumber={currentDrawer + 1}
            round={round}
            seconds={DRAW_SECONDS}
            onComplete={onDrawingComplete}
          />
        )}

        {phase === PHASES.ROUND_END && (
          <RoundEndScreen round={round} onShowGallery={startGallery} />
        )}

        {phase === PHASES.GALLERY && (
          <GalleryScreen
            drawings={drawings.filter((d) => d.round === round)}
            idx={galleryIdx}
            round={round}
            onNext={nextGalleryOrDiscussion}
          />
        )}

        {phase === PHASES.DISCUSSION && (
          <DiscussionScreen
            seconds={DISCUSSION_SECONDS}
            round={round}
            totalRounds={TOTAL_ROUNDS}
            onEnd={endDiscussion}
            allDrawings={drawings}
          />
        )}

        {phase === PHASES.VOTE && (
          <VoteScreen
            playerCount={playerCount}
            votes={votes}
            castVote={castVote}
          />
        )}

        {phase === PHASES.RESULTS && (
          <ResultsScreen
            votes={votes}
            imposterIdx={imposterIdx}
            playerCount={playerCount}
            topics={topics}
            allDrawings={drawings}
            onRestart={resetAll}
          />
        )}
      </div>
    </div>
  );
}

// ─── SETUP ────────────────────────────────────────────────────────────────
function SetupScreen({ playerCount, setPlayerCount, startGame }) {
  return (
    <div className="pt-8 pb-12">
      <div className="mb-12 text-center">
        <div className="inline-block mb-3 px-3 py-1 border border-pink-400/40 rounded-full text-pink-300 text-xs tracking-[0.3em]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          PASS · DRAW · DECEIVE
        </div>
        <h1 className="leading-[0.85] tracking-tight" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(4rem, 15vw, 7rem)" }}>
          THE
          <br />
          <span className="italic" style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 50%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            IMPOSTER
          </span>
        </h1>
        <p className="text-stone-400 mt-4 text-sm leading-relaxed max-w-sm mx-auto">
          One of you draws something <em>almost</em> right. The rest of you have to figure out who.
        </p>
      </div>

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-6 mb-6">
        <div className="text-xs text-stone-400 tracking-[0.25em] mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          HOW MANY PLAYERS?
        </div>
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => setPlayerCount(Math.max(3, playerCount - 1))}
            className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition text-2xl"
          >
            −
          </button>
          <div className="text-center">
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "5rem", lineHeight: 1 }}>
              {playerCount}
            </div>
            <div className="text-xs text-stone-500 tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              PLAYERS
            </div>
          </div>
          <button
            onClick={() => setPlayerCount(Math.min(10, playerCount + 1))}
            className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition text-2xl"
          >
            +
          </button>
        </div>
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 mb-8 text-sm text-stone-300 leading-relaxed">
        <div className="text-xs text-pink-300 tracking-[0.25em] mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          THE RULES
        </div>
        <ol className="space-y-2 list-decimal list-inside marker:text-pink-400/60">
          <li>Decide who is Player 1, 2, 3…</li>
          <li>Each player secretly reveals their card.</li>
          <li>Pass the phone, draw your word, repeat.</li>
          <li>{TOTAL_ROUNDS} rounds. Then vote on the imposter.</li>
        </ol>
      </div>

      <button
        onClick={startGame}
        className="w-full py-5 rounded-full text-black font-bold tracking-wider active:scale-[0.98] transition shadow-lg shadow-pink-500/30"
        style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.5rem", letterSpacing: "0.15em" }}
      >
        BEGIN THE GAME →
      </button>
    </div>
  );
}

// ─── REVEAL ───────────────────────────────────────────────────────────────
function RevealScreen({ playerCount, revealed, openRevealCard, showRevealCard, revealStep, unlockReveal, closeReveal, isImposter, topic, round, totalRounds }) {
  const isFirstRound = round === 1;
  return (
    <div className="pt-6 pb-8">
      <div className="text-center mb-8">
        <div className="text-xs text-pink-300 tracking-[0.3em] mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {isFirstRound ? "STEP 01 · SECRET REVEAL" : `ROUND ${round} / ${totalRounds} · NEW WORD`}
        </div>
        <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(2.5rem, 8vw, 3.5rem)", lineHeight: 1 }}>
          TAP YOUR CARD
        </h2>
        <p className="text-stone-400 text-sm mt-3 max-w-sm mx-auto">
          {isFirstRound
            ? "One at a time. Don't let anyone else see your screen."
            : "Each round has a different word. Peek at yours — privately."}
        </p>
      </div>

      <div className={`grid gap-3 ${playerCount <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
        {Array.from({ length: playerCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => openRevealCard(i)}
            disabled={revealed[i]}
            className={`aspect-[3/4] rounded-2xl border relative overflow-hidden transition active:scale-95 ${
              revealed[i]
                ? "bg-emerald-500/10 border-emerald-400/40"
                : "bg-white/5 border-white/15 hover:border-pink-400/60 hover:bg-white/10"
            }`}
          >
            {/* Card pattern */}
            {!revealed[i] && (
              <div className="absolute inset-0" style={{
                backgroundImage: "repeating-linear-gradient(45deg, rgba(244, 114, 182, 0.06) 0, rgba(244, 114, 182, 0.06) 2px, transparent 2px, transparent 8px)",
              }} />
            )}
            <div className="relative h-full flex flex-col items-center justify-center">
              <div className="text-xs tracking-[0.25em] text-stone-500 mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {revealed[i] ? "SEEN" : "PLAYER"}
              </div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3.5rem", lineHeight: 1, color: revealed[i] ? "#34d399" : "#fff" }}>
                {revealed[i] ? "✓" : i + 1}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Reveal modal */}
      {showRevealCard !== false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ backgroundColor: "rgba(8, 6, 18, 0.92)", backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-sm">
            {revealStep === "locked" ? (
              <div className="text-center">
                <div className="text-xs text-pink-300 tracking-[0.3em] mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  PLAYER {showRevealCard + 1}
                </div>
                <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "2.5rem", lineHeight: 1 }} className="mb-4">
                  ALONE?
                </h3>
                <p className="text-stone-300 mb-8 text-sm">
                  Make sure no one else can see your screen. Only Player {showRevealCard + 1} should be looking.
                </p>
                <button
                  onClick={unlockReveal}
                  className="w-full py-4 rounded-full text-black font-bold tracking-wider active:scale-[0.98] transition"
                  style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.25rem", letterSpacing: "0.15em" }}
                >
                  REVEAL MY CARD
                </button>
              </div>
            ) : (
              <div className="text-center">
                {isImposter ? (
                  <>
                    <div className="text-xs tracking-[0.4em] mb-2 text-red-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      ⚠ YOU ARE THE
                    </div>
                    <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "5rem", lineHeight: 1, background: "linear-gradient(135deg, #f87171 0%, #f472b6 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }} className="mb-6">
                      IMPOSTER
                    </h3>
                    <div className="bg-red-500/10 border border-red-400/40 rounded-2xl p-5 mb-6">
                      <div className="text-xs text-red-300 tracking-widest mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        YOUR WORD
                      </div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "2.5rem" }}>
                        {topic[1]}
                      </div>
                      <div className="text-xs text-stone-400 mt-3 leading-relaxed">
                        Draw this. It's <em>close</em> to what others have, but not the same. Blend in.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs tracking-[0.4em] mb-2 text-emerald-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      YOUR SECRET WORD
                    </div>
                    <div className="bg-white/5 border border-emerald-400/40 rounded-2xl p-8 mb-6">
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3.5rem", lineHeight: 1 }}>
                        {topic[0]}
                      </div>
                    </div>
                    <p className="text-stone-400 text-sm mb-6">
                      Draw this when it's your turn. Watch the others — one of them has a different word.
                    </p>
                  </>
                )}
                <button
                  onClick={closeReveal}
                  className="w-full py-4 rounded-full bg-white/10 hover:bg-white/20 transition active:scale-[0.98]"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem", letterSpacing: "0.15em" }}
                >
                  GOT IT — HIDE
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HANDOFF ──────────────────────────────────────────────────────────────
function HandoffScreen({ playerNumber, round, totalRounds, onReady }) {
  const [secondsLeft, setSecondsLeft] = useState(HANDOFF_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center">
      <div className="text-xs tracking-[0.3em] text-stone-500 mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        ROUND {round} / {totalRounds}
      </div>
      <div className="text-stone-400 mb-2 text-sm">Pass the phone to</div>
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(5rem, 20vw, 8rem)", lineHeight: 0.9 }} className="mb-2">
        PLAYER
      </h2>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(8rem, 30vw, 12rem)", lineHeight: 1, background: "linear-gradient(135deg, #f472b6 0%, #c084fc 50%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        {playerNumber}
      </div>

      <button
        onClick={onReady}
        disabled={secondsLeft > 0}
        className={`mt-10 w-full max-w-sm py-5 rounded-full font-bold tracking-wider active:scale-[0.98] transition ${
          secondsLeft > 0
            ? "bg-white/5 text-stone-500 border border-white/10"
            : "text-black shadow-lg shadow-pink-500/30"
        }`}
        style={
          secondsLeft > 0
            ? { fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", letterSpacing: "0.15em" }
            : { background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", letterSpacing: "0.15em" }
        }
      >
        {secondsLeft > 0 ? `READY IN ${secondsLeft}s` : "I'M READY → DRAW"}
      </button>
    </div>
  );
}

// ─── DRAWING ──────────────────────────────────────────────────────────────
function DrawingScreen({ playerNumber, round, seconds, onComplete }) {
  const canvasRef = useRef(null);
  const [secondsLeft, setSecondsLeft] = useState(seconds);
  const [color, setColor] = useState("#ffffff");
  const [size, setSize] = useState(4);
  const drawing = useRef(false);
  const lastPt = useRef(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#1a1825";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) {
      playFinalBeep();
      handleSubmit();
      return;
    }
    // tick on every second; urgent (higher pitch) in final 5
    if (secondsLeft <= seconds) {
      playTick(secondsLeft <= 5);
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  function getPoint(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing.current = true;
    lastPt.current = getPoint(e);
  }

  function moveDraw(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const pt = getPoint(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPt.current = pt;
  }

  function endDraw() {
    drawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#1a1825";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }

  function handleSubmit() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onComplete(dataUrl);
  }

  const pct = (secondsLeft / seconds) * 100;
  const colors = ["#ffffff", "#f472b6", "#c084fc", "#818cf8", "#34d399", "#fbbf24", "#fb7185", "#1a1825"];

  return (
    <div className="pt-2 pb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs tracking-[0.25em] text-stone-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          P{playerNumber} · R{round}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace" }} className={`text-2xl font-bold ${secondsLeft <= 5 ? "text-red-400 animate-pulse" : "text-white"}`}>
          {secondsLeft}s
        </div>
      </div>

      <div className="h-1.5 bg-white/10 rounded-full mb-3 overflow-hidden">
        <div className="h-full transition-all duration-1000 linear" style={{ width: `${pct}%`, background: secondsLeft <= 5 ? "#ef4444" : "linear-gradient(90deg, #f472b6, #c084fc)" }} />
      </div>

      <canvas
        ref={canvasRef}
        className="w-full rounded-2xl border border-white/15 touch-none block"
        style={{ aspectRatio: "1 / 1", backgroundColor: "#1a1825" }}
        onMouseDown={startDraw}
        onMouseMove={moveDraw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={moveDraw}
        onTouchEnd={endDraw}
      />

      <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-9 h-9 rounded-full flex-shrink-0 transition ${color === c ? "ring-2 ring-white scale-110" : ""}`}
            style={{ backgroundColor: c, border: c === "#1a1825" ? "1px solid rgba(255,255,255,0.3)" : "1px solid rgba(255,255,255,0.1)" }}
            aria-label={c === "#1a1825" ? "eraser" : c}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 bg-white/5 rounded-full px-4 py-2 border border-white/10">
          <span className="text-xs text-stone-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>SIZE</span>
          <input
            type="range"
            min="2"
            max="20"
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value))}
            className="flex-1 accent-pink-400"
          />
        </div>
        <button
          onClick={clearCanvas}
          className="px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition text-sm"
        >
          Clear
        </button>
      </div>

      <button
        onClick={handleSubmit}
        className="w-full mt-4 py-4 rounded-full text-black font-bold tracking-wider active:scale-[0.98] transition"
        style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.2rem", letterSpacing: "0.15em" }}
      >
        DONE — PASS PHONE →
      </button>
    </div>
  );
}

// ─── ROUND END ────────────────────────────────────────────────────────────
function RoundEndScreen({ round, onShowGallery }) {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center">
      <div className="text-xs tracking-[0.3em] text-pink-300 mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        ROUND {round} COMPLETE
      </div>
      <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(3.5rem, 12vw, 5rem)", lineHeight: 0.9 }} className="mb-3">
        THE
        <br />
        GALLERY
        <br />
        AWAITS
      </h2>
      <p className="text-stone-400 max-w-sm mb-10 text-sm leading-relaxed">
        Time to look at every drawing. Nobody knows who drew what — that's the fun part.
      </p>
      <button
        onClick={onShowGallery}
        className="w-full max-w-sm py-5 rounded-full text-black font-bold active:scale-[0.98] transition shadow-lg shadow-pink-500/30"
        style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", letterSpacing: "0.15em" }}
      >
        REVEAL THE DRAWINGS
      </button>
    </div>
  );
}

// ─── GALLERY ──────────────────────────────────────────────────────────────
function GalleryScreen({ drawings, idx, round, onNext }) {
  // Shuffle order so player order is hidden
  const shuffledRef = useRef(null);
  if (!shuffledRef.current || shuffledRef.current.length !== drawings.length) {
    shuffledRef.current = [...drawings].sort(() => Math.random() - 0.5);
  }
  const current = shuffledRef.current[idx];
  const isLast = idx + 1 >= drawings.length;

  return (
    <div className="pt-4 pb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs tracking-[0.25em] text-stone-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          ROUND {round} · GALLERY
        </div>
        <div className="text-xs tracking-[0.25em] text-pink-300" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {idx + 1} / {drawings.length}
        </div>
      </div>

      <div className="text-center mb-4">
        <div className="text-stone-500 text-xs tracking-widest mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          DRAWING #{idx + 1}
        </div>
        <h3 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "2rem", lineHeight: 1 }}>
          WHO DREW THIS?
        </h3>
      </div>

      <div className="rounded-3xl overflow-hidden border-2 border-white/15 mb-5" style={{ background: "linear-gradient(135deg, rgba(244, 114, 182, 0.1), rgba(192, 132, 252, 0.1))" }}>
        <img src={current.dataUrl} alt={`Drawing ${idx + 1}`} className="w-full block" style={{ aspectRatio: "1 / 1" }} />
      </div>

      <button
        onClick={onNext}
        className="w-full py-4 rounded-full text-black font-bold tracking-wider active:scale-[0.98] transition"
        style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.2rem", letterSpacing: "0.15em" }}
      >
        {isLast ? "START DISCUSSION →" : "NEXT DRAWING →"}
      </button>
    </div>
  );
}

// ─── DISCUSSION ───────────────────────────────────────────────────────────
function DiscussionScreen({ seconds, round, totalRounds, onEnd, allDrawings }) {
  const [secondsLeft, setSecondsLeft] = useState(seconds);
  const roundDrawings = allDrawings.filter((d) => d.round === round);
  // shuffled order
  const shuffledRef = useRef(null);
  if (!shuffledRef.current || shuffledRef.current.length !== roundDrawings.length) {
    shuffledRef.current = [...roundDrawings].sort(() => Math.random() - 0.5);
  }

  useEffect(() => {
    if (secondsLeft <= 0) {
      playFinalBeep();
      return;
    }
    if (secondsLeft <= 10) {
      playTick(secondsLeft <= 5);
    }
    const t = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const isFinalRound = round >= totalRounds;
  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="pt-4 pb-8">
      <div className="text-center mb-5">
        <div className="text-xs tracking-[0.3em] text-pink-300 mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          DISCUSS · ROUND {round}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace" }} className={`text-5xl font-bold ${secondsLeft <= 10 ? "text-red-400 animate-pulse" : "text-white"}`}>
          {minutes}:{secs.toString().padStart(2, "0")}
        </div>
        <p className="text-stone-400 text-sm mt-2 max-w-sm mx-auto">
          {isFinalRound
            ? "Last round. Talk it through — you'll vote next."
            : "Talk it out. Don't vote yet — there's a new word coming."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        {shuffledRef.current.map((d, i) => (
          <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-white/5">
            <img src={d.dataUrl} alt={`Drawing ${i + 1}`} className="w-full block" style={{ aspectRatio: "1 / 1" }} />
          </div>
        ))}
      </div>

      <button
        onClick={onEnd}
        className="w-full py-4 rounded-full font-bold tracking-wider active:scale-[0.98] transition"
        style={
          secondsLeft <= 0
            ? { background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", color: "#000", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.2rem", letterSpacing: "0.15em" }
            : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.2rem", letterSpacing: "0.15em" }
        }
      >
        {isFinalRound ? "GO TO VOTE →" : `NEXT ROUND (${round + 1}) →`}
      </button>
    </div>
  );
}

// ─── VOTE ─────────────────────────────────────────────────────────────────
function VoteScreen({ playerCount, votes, castVote }) {
  const [currentVoter, setCurrentVoter] = useState(0);
  const [showHandoff, setShowHandoff] = useState(true);

  function handleVote(idx) {
    castVote(currentVoter, idx);
    if (currentVoter + 1 < playerCount) {
      setCurrentVoter(currentVoter + 1);
      setShowHandoff(true);
    }
  }

  if (showHandoff && !votes[currentVoter]) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center text-center">
        <div className="text-xs tracking-[0.3em] text-pink-300 mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          FINAL VOTE
        </div>
        <div className="text-stone-400 mb-2 text-sm">Pass to</div>
        <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(5rem, 20vw, 7rem)", lineHeight: 0.9 }} className="mb-2">
          PLAYER
        </h2>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(7rem, 25vw, 10rem)", lineHeight: 1, background: "linear-gradient(135deg, #f472b6 0%, #c084fc 50%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {currentVoter + 1}
        </div>
        <p className="text-stone-400 mt-6 mb-8 max-w-sm text-sm">
          Cast your vote in private. Who do you think the imposter is?
        </p>
        <button
          onClick={() => setShowHandoff(false)}
          className="w-full max-w-sm py-5 rounded-full text-black font-bold active:scale-[0.98] transition shadow-lg shadow-pink-500/30"
          style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", letterSpacing: "0.15em" }}
        >
          I'M READY TO VOTE →
        </button>
      </div>
    );
  }

  return (
    <div className="pt-6 pb-8">
      <div className="text-center mb-6">
        <div className="text-xs tracking-[0.3em] text-pink-300 mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          PLAYER {currentVoter + 1} VOTING
        </div>
        <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(2.5rem, 8vw, 3rem)", lineHeight: 1 }}>
          WHO IS THE
          <br />
          <span style={{ background: "linear-gradient(135deg, #f87171 0%, #f472b6 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>IMPOSTER?</span>
        </h2>
      </div>

      <div className={`grid gap-3 ${playerCount <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
        {Array.from({ length: playerCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => handleVote(i)}
            disabled={i === currentVoter}
            className={`aspect-[3/4] rounded-2xl border transition active:scale-95 ${
              i === currentVoter
                ? "bg-white/5 border-white/5 opacity-30"
                : "bg-white/5 border-white/15 hover:border-red-400/60 hover:bg-red-500/10"
            }`}
          >
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-xs tracking-[0.25em] text-stone-500 mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {i === currentVoter ? "YOU" : "PLAYER"}
              </div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3.5rem", lineHeight: 1 }}>
                {i + 1}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── RESULTS ──────────────────────────────────────────────────────────────
function ResultsScreen({ votes, imposterIdx, playerCount, topics, allDrawings, onRestart }) {
  // Tally votes
  const tally = {};
  Object.values(votes).forEach((v) => {
    tally[v] = (tally[v] || 0) + 1;
  });
  const maxVotes = Math.max(...Object.values(tally), 0);
  const accusedSet = Object.entries(tally)
    .filter(([_, c]) => c === maxVotes)
    .map(([k]) => parseInt(k));
  const accused = accusedSet[0];
  const groupWon = accusedSet.length === 1 && accused === imposterIdx;

  return (
    <div className="pt-4 pb-10">
      <div className="text-center mb-6">
        <div className="text-xs tracking-[0.3em] text-pink-300 mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          THE TRUTH
        </div>
        <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(3rem, 11vw, 4.5rem)", lineHeight: 0.9 }} className="mb-2">
          {groupWon ? "GROUP" : "IMPOSTER"}
          <br />
          <span style={{ background: groupWon ? "linear-gradient(135deg, #34d399 0%, #818cf8 100%)" : "linear-gradient(135deg, #f87171 0%, #fbbf24 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            WINS
          </span>
        </h2>
      </div>

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-6 mb-4">
        <div className="text-xs text-stone-400 tracking-[0.25em] mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          THE IMPOSTER WAS
        </div>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f87171 0%, #f472b6 100%)" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "3rem", lineHeight: 1, color: "#0c0a14" }}>
              {imposterIdx + 1}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.8rem", lineHeight: 1 }}>
              PLAYER {imposterIdx + 1}
            </div>
            <div className="text-stone-400 text-sm">drew the wrong word every round</div>
          </div>
        </div>
      </div>

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-6 mb-4">
        <div className="text-xs text-stone-400 tracking-[0.25em] mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          THE WORDS
        </div>
        <div className="space-y-3">
          {topics.map((t, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr] gap-3 items-center pb-3 border-b border-white/5 last:border-b-0 last:pb-0">
              <div className="text-xs text-pink-300 w-12" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                R{i + 1}
              </div>
              <div>
                <div className="text-[10px] text-emerald-400 tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>REAL</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", lineHeight: 1.1 }}>{t[0]}</div>
              </div>
              <div>
                <div className="text-[10px] text-red-400 tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>IMPOSTER</div>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", lineHeight: 1.1 }}>{t[1]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-6 mb-4">
        <div className="text-xs text-stone-400 tracking-[0.25em] mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          VOTE TALLY
        </div>
        <div className="space-y-2">
          {Array.from({ length: playerCount }).map((_, i) => {
            const count = tally[i] || 0;
            const pct = maxVotes ? (count / maxVotes) * 100 : 0;
            const isImp = i === imposterIdx;
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 text-center" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem" }}>
                  P{i + 1}
                </div>
                <div className="flex-1 h-7 bg-white/5 rounded-full overflow-hidden relative">
                  <div
                    className="h-full transition-all duration-700 rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: isImp
                        ? "linear-gradient(90deg, #f87171, #f472b6)"
                        : "linear-gradient(90deg, #818cf8, #c084fc)",
                    }}
                  />
                </div>
                <div className="w-8 text-right text-sm text-stone-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {count}
                </div>
                {isImp && <span className="text-xs text-red-400">⚠</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-6 mb-6">
        <div className="text-xs text-stone-400 tracking-[0.25em] mb-3" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          ALL DRAWINGS
        </div>
        <div className="space-y-3">
          {Array.from({ length: TOTAL_ROUNDS }).map((_, r) => {
            const roundNum = r + 1;
            const dr = allDrawings.filter((d) => d.round === roundNum);
            if (!dr.length) return null;
            const t = topics[r];
            return (
              <div key={roundNum}>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-xs text-pink-300" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    ROUND {roundNum}
                  </div>
                  <div className="text-xs text-stone-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {t ? `${t[0]} / ${t[1]}` : ""}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {dr
                    .sort((a, b) => a.player - b.player)
                    .map((d) => (
                      <div key={d.player} className={`rounded-lg overflow-hidden border ${d.player === imposterIdx ? "border-red-400" : "border-white/10"} relative`}>
                        <img src={d.dataUrl} alt="" className="w-full block" style={{ aspectRatio: "1 / 1" }} />
                        <div className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${d.player === imposterIdx ? "bg-red-500 text-white" : "bg-black/60 text-white"}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                          P{d.player + 1}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={onRestart}
        className="w-full py-5 rounded-full text-black font-bold tracking-wider active:scale-[0.98] transition shadow-lg shadow-pink-500/30"
        style={{ background: "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.3rem", letterSpacing: "0.15em" }}
      >
        PLAY AGAIN →
      </button>
    </div>
  );
}