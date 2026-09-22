import React, { useEffect, useMemo, useRef, useState } from 'react';
import { drawOneWinner, getPersonCouponCount, prepareExcel, removeWinnerFromPool, NUMBER_OF_WINNERS } from './drawEngine';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const [screen, setScreen] = useState('upload');
  const [prepared, setPrepared] = useState(null);
  const [remaining, setRemaining] = useState([]);
  const [winners, setWinners] = useState([]);
  const [round, setRound] = useState(1);
  const [state, setState] = useState('ready');
  const [reels, setReels] = useState([]);
  const [locked, setLocked] = useState([]);
  const [status, setStatus] = useState('UPLOAD YOUR FINAL COUPON MASTER');
  const [substatus, setSubstatus] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const audioRef = useRef(null);

  const currentWinner = state === 'winner' ? (winners[winners.length - 1] ?? null) : null;
  const winnerCouponCount = useMemo(() => currentWinner && prepared ? getPersonCouponCount(prepared.participants, currentWinner) : 0, [currentWinner, prepared]);

  useEffect(() => {
    const handleKey = (e) => {
      const key = e.key.toLowerCase();

      // Navigation shortcuts should work even if a button/input still has focus.
      if (screen === 'review' && e.key === 'ArrowLeft') {
        e.preventDefault();
        setScreen('upload');
        return;
      }

      if (['INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) return;

      if (key === 'f') toggleFullscreen();
      if (key === 'm') setMuted((v) => !v);
      if (screen === 'review' && key === 'enter' && prepared) setScreen('stage');
      if (screen !== 'stage') return;
      if (key === 'r') resetShow();
      if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'ready') runDraw();
        else if (state === 'winner') nextWinner();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  useEffect(() => {
    const listener = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', listener);
    return () => document.removeEventListener('fullscreenchange', listener);
  }, []);

  // Reset the browser scroll position whenever we switch between
  // the scrollable admin page and the fixed LED-wall stage view.
  // Without this, entering stage mode can preserve the admin page's
  // previous scroll offset, making the top of the stage appear clipped.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [screen]);

  async function upload(file) {
    if (!file) return;
    try {
      setError('');
      const data = await prepareExcel(file);
      setPrepared(data);
      setRemaining(data.participants);
      setWinners([]);
      setRound(1);
      setReels(Array(data.couponWidth).fill('0'));
      setLocked(Array(data.couponWidth).fill(false));
      setState('ready');
      setStatus('FINAL DRAW DATA READY');
      setSubstatus('Review the pool, then enter stage mode.');
      setScreen('review');
    } catch (err) {
      setPrepared(null);
      setError(err instanceof Error ? err.message : 'Could not read the Excel file.');
    }
  }

  function audioContext() {
    if (muted) return null;
    if (!audioRef.current) audioRef.current = new window.AudioContext();
    if (audioRef.current.state === 'suspended') audioRef.current.resume();
    return audioRef.current;
  }

  function tone(freq, duration = 0.08, type = 'sine') {
    const ctx = audioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function enterStage() {
    setState('ready');
    setReels(prepared ? Array(prepared.couponWidth).fill('0') : []);
    setLocked(prepared ? Array(prepared.couponWidth).fill(false) : []);
    setStatus('READY FOR THE FIRST DRAW');
    setSubstatus('Press SPACE to begin');
    setScreen('stage');
  }

  function resetShow() {
    if (!prepared) return;
    setRemaining(prepared.participants);
    setWinners([]);
    setRound(1);
    setReels(Array(prepared.couponWidth).fill('0'));
    setLocked(Array(prepared.couponWidth).fill(false));
    setState('ready');
    setStatus('READY FOR THE FIRST DRAW');
    setSubstatus('Press SPACE to begin');
  }

  async function spinTo(index, finalDigit) {
    // The draw is intentionally paced for a live audience. Each reel gets
    // several seconds of readable motion, followed by a clear pause once
    // the digit locks before the next reel starts.
    const total = 30 + index * 4;
    const interval = 112;

    for (let i = 0; i < total; i++) {
      setReels((current) =>
        current.map((v, j) =>
          j === index ? String((Number(v) + 1) % 10) : v
        )
      );

      // A restrained mechanical tick rather than a constant loud tone.
      // This keeps the sound present without becoming tiring over a long draw.
      if (i % 2 === 0) tone(145 + index * 28 + (i % 6) * 7, 0.035, 'square');
      await wait(interval);
    }

    setReels((current) =>
      current.map((v, j) => j === index ? finalDigit : v)
    );

    setLocked((current) =>
      current.map((v, j) => j === index ? true : v)
    );

    // Bright lock sound + a full second for the room to read the result.
    tone(350 + index * 80, 0.16, 'triangle');
    await wait(1050);
  }

  async function runDraw() {
    if (!prepared || !remaining.length || state !== 'ready') return;
    audioContext();
    setState('countdown');
    setStatus(`WINNER ${round} / ${NUMBER_OF_WINNERS}`);
    setSubstatus('Get ready…');
    setLocked(Array(prepared.couponWidth).fill(false));
    setReels(Array(prepared.couponWidth).fill('0'));
    tone(210, 0.14, 'triangle');
    await wait(650);
    tone(265, 0.14, 'triangle');
    await wait(650);
    setState('spinning');
    setSubstatus('Every digit is being selected from the live eligible pool.');
    const result = await drawOneWinner(remaining, prepared.couponWidth, async (step) => {
      await spinTo(step.position - 1, step.digit);
      setSubstatus(step.position === step.totalDigits ? 'Final digit locked.' : `${step.candidatesRemaining} possible coupons remain.`);
    });
    const winner = result.winner;
    setWinners((current) => [...current, winner]);
    setRemaining((current) => removeWinnerFromPool(current, winner));
    setStatus('WE HAVE A WINNER');
    setSubstatus(`${winner.name} • Flat ${winner.flat}`);
    setState('winner');
    // Let the winning number land first. The announcement sound is fired
    // by WinnerReveal after its visual transition begins.
    tone(523, 0.22, 'triangle');
  }

  function playWinnerRevealSound() {
    if (muted) return;
    const ctx = audioContext();
    if (!ctx) return;

    // Short suspense sweep, then a warm three-note reveal chord.
    const now = ctx.currentTime;
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(220, now);
    sweep.frequency.exponentialRampToValueAtTime(720, now + 0.8);
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.07, now + 0.12);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    sweep.connect(sweepGain).connect(ctx.destination);
    sweep.start(now);
    sweep.stop(now + 0.94);

    [392, 494, 587].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + 0.42 + index * 0.12;
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.085, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.75);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.78);
    });
  }

  function nextWinner() {
    if (round >= NUMBER_OF_WINNERS) {
      setState('complete');
      setStatus("TONIGHT'S WINNERS");
      setSubstatus('Three names. One unforgettable moment.');
      return;
    }
    setRound((r) => r + 1);
    setState('ready');
    setReels(Array(prepared.couponWidth).fill('0'));
    setLocked(Array(prepared.couponWidth).fill(false));
    setStatus(`WINNER ${round + 1} / ${NUMBER_OF_WINNERS}`);
    setSubstatus('Press SPACE to begin');
  }

  return (
    <div className={`app ${screen !== 'stage' ? 'admin-mode' : 'stage-mode'}`}>
      <Background />
      {screen === 'upload' ? (
        <UploadScreen error={error} onUpload={upload} />
      ) : screen === 'review' ? (
        <ReviewScreen prepared={prepared} onEnter={enterStage} onBack={() => setScreen('upload')} />
      ) : (
        <StageScreen
          remaining={remaining}
          winners={winners}
          round={round}
          state={state}
          reels={reels}
          locked={locked}
          status={status}
          substatus={substatus}
          currentWinner={currentWinner}
          winnerCouponCount={winnerCouponCount}
          muted={muted}
          full={full}
          onMute={() => setMuted((v) => !v)}
          onFull={toggleFullscreen}
          onStart={runDraw}
          onNext={nextWinner}
          onReset={resetShow}
          onRevealSound={playWinnerRevealSound}
        />
      )}
    </div>
  );
}

function Background() {
  return (
    <>
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <div className="grain" />
      <div className="pookalam" aria-hidden="true" />
      <div className="floating-petals" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <span key={i} />)}
      </div>
    </>
  );
}

function AdminHeader({ compact = false }) {
  return (
    <div className={`admin-header ${compact ? 'compact' : ''}`}>
      <div className="brand"><span>✦</span><div><b>MJ Lifestyle Amadeus</b><small>LUCKY DRAW</small></div></div>
      <div className="eyebrow">A BRIGHTER NEIGHBOURHOOD TOGETHER</div>
    </div>
  );
}

function UploadScreen({ error, onUpload }) {
  return (
    <main className="admin upload-screen">
      <div className="admin-card upload-card">
        <AdminHeader />
        <div className="upload-copy">
          <div className="eyebrow">FINAL EVENT DATA</div>
          <h1>Load the <em>lucky draw</em></h1>
          <p className="lead">Upload the final Excel from <strong>Coupon Master</strong>. Once loaded, the app prepares the exact pool that will be used on stage.</p>
        </div>
        <label className="dropzone">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onUpload(e.target.files?.[0])} />
          <div className="upload-symbol">✦</div>
          <div className="upload-title">Drop your Excel here</div>
          <div className="upload-help">or click to browse • .xlsx / .xls / .csv</div>
        </label>
        {error && <div className="error">{error}</div>}
        <div className="hint upload-hint">The final file stays in this browser session. &nbsp;•&nbsp; ENTER after loading opens the review screen.</div>
      </div>
    </main>
  );
}

function ReviewScreen({ prepared, onEnter, onBack }) {
  if (!prepared) return null;
  return (
    <main className="admin review-screen">
      <div className="review-shell">
        <div className="review-topbar">
          <button className="back-button" onClick={onBack} title="Back to upload">← <span>UPLOAD FILE</span></button>
          <AdminHeader compact />
          <div className="review-ready">FINAL DRAW DATA READY</div>
        </div>

        <section className="review-hero">
          <div>
            <div className="eyebrow">DATA CHECK COMPLETE</div>
            <h1>Everything is <em>ready</em></h1>
            <p className="lead">The pool below is frozen for the event. Test coupons are excluded and duplicate coupon numbers have been reassigned without losing the original ownership trail.</p>
          </div>
          <div className="review-shortcut">← back to upload &nbsp;•&nbsp; ENTER stage mode</div>
        </section>

        <section className="summary review-summary">
          <div className="summary-grid">
            <Stat label="Rows loaded" value={prepared.sourceRows} />
            <Stat label="Test removed" value={prepared.testCouponsRemoved} />
            <Stat label="Duplicates resolved" value={prepared.duplicateChanges.length} />
            <Stat label="Final coupons" value={prepared.participants.length} />
          </div>
        </section>

        <section className="review-bottom">
          <div className="changes changes-review">
            <div className="changes-heading">
              <b>Duplicate reassignments</b>
              <span>{prepared.duplicateChanges.length} total</span>
            </div>
            <div className="changes-list">
              {prepared.duplicateChanges.length === 0 ? (
                <div className="no-changes">No duplicate coupon numbers were found.</div>
              ) : (
                prepared.duplicateChanges.slice(0, 7).map((c) => (
                  <div className="change-row" key={c.excelRow}>
                    <span className="change-number">{c.originalCoupon} → {c.assignedCoupon}</span>
                    <span className="change-person">{c.name} • {c.flat}</span>
                  </div>
                ))
              )}
              {prepared.duplicateChanges.length > 7 && (
                <div className="more-row">+ {prepared.duplicateChanges.length - 7} more reassignments</div>
              )}
            </div>
          </div>

          <div className="review-action-card">
            <div className="review-action-label">EVENT MODE</div>
            <strong>{prepared.participants.length} coupons</strong>
            <span>3 winners • one person can win only once</span>
            <button className="gold-button" onClick={onEnter}>ENTER STAGE MODE <span>→</span></button>
          </div>
        </section>

        <div className="review-footer-hint">← BACK &nbsp;•&nbsp; ENTER STAGE MODE &nbsp;•&nbsp; F FULLSCREEN &nbsp;•&nbsp; M SOUND</div>
      </div>
    </main>
  );
}

function Stat({ label, value }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function StageScreen({ remaining, winners, round, state, reels, locked, status, substatus, currentWinner, winnerCouponCount, muted, full, onMute, onFull, onStart, onNext, onReset, onRevealSound }) {
  return (
    <main className={`stage stage-state-${state}`}>
      <header className="stage-top">
        <div className="brand"><span>✦</span><div><b>MJ Lifestyle Amadeus</b><small>LUCKY DRAW</small></div></div>
        <div className="top-actions">
          <span>{remaining.length} coupons remaining</span>
          <button onClick={onMute}>{muted ? 'SOUND OFF' : 'SOUND ON'}</button>
          <button onClick={onFull}>{full ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}</button>
        </div>
      </header>

      <div className="stage-body">
        {state === 'complete' ? (
          <FinalWinners winners={winners} onReset={onReset} />
        ) : state === 'winner' && currentWinner ? (
          <WinnerReveal winner={currentWinner} round={round} count={winnerCouponCount} onNext={onNext} onRevealSound={onRevealSound} />
        ) : (
          <DrawView reels={reels} locked={locked} state={state} round={round} status={status} substatus={substatus} onStart={onStart} />
        )}
      </div>

      <footer className="stage-bottom">
        <span>SPACE start / next • R reset • F fullscreen • M mute</span>
        {winners.length > 0 && <span>{winners.length} winner{winners.length > 1 ? 's' : ''} selected</span>}
      </footer>
    </main>
  );
}

function DrawView({ reels, locked, state, round, status, substatus, onStart }) {
  return (
    <section className="draw-view">
      <div className="round-pill">WINNER {round} / {NUMBER_OF_WINNERS}</div>
      <div className="eyebrow">THE NEXT LUCKY COUPON</div>
      <h1>Find the <em>lucky number</em></h1>

      <div className="reel-deck">
        {reels.map((digit, index) => (
          <div className={`reel-wrap ${locked[index] ? 'is-locked' : ''}`} key={index}>
            <div className={`reel ${state === 'spinning' || state === 'countdown' ? 'is-spinning' : ''}`}>
              <div className="fade-top" /><div className="fade-bottom" />
              <div className="reel-line line-top" /><div className="reel-line line-bottom" />
              <div className="ghost ghost-top">{(Number(digit) + 9) % 10}</div>
              <div className="main-digit" key={`${index}-${digit}`}>{digit}</div>
              <div className="ghost ghost-bottom">{(Number(digit) + 1) % 10}</div>
            </div>
            <div className="lock-label">{locked[index] ? 'LOCKED' : 'SPINNING'}</div>
          </div>
        ))}
      </div>

      <div className="draw-status"><span />{status}</div>
      {state !== 'ready' && substatus && <div className="draw-substatus">{substatus}</div>}
      {state === 'ready' && <button className="gold-button start" onClick={onStart}>START DRAW <b>SPACE</b> <span>→</span></button>}
      {state === 'countdown' && <div className="countdown">Get ready…</div>}
      {state === 'spinning' && <div className="spin-note">The reels are deciding…</div>}
    </section>
  );
}

function WinnerReveal({ winner, round, onNext, onRevealSound }) {
  const [revealDetails, setRevealDetails] = useState(false);

  useEffect(() => {
    // Give the winning coupon number its own moment before transforming
    // the reveal into the full lottery-ticket presentation.
    const timer = window.setTimeout(() => {
      setRevealDetails(true);
      onRevealSound?.();
    }, 2100);
    return () => window.clearTimeout(timer);
  }, [winner, onRevealSound]);

  return (
    <section className={`winner-reveal ${revealDetails ? 'winner-details-visible' : ''}`}>
      <div className="winner-halo" />

      <div className="winner-header">
        <div className="eyebrow winner-eyebrow">✦ WE HAVE A WINNER ✦</div>
      </div>

      <div className="winner-stage-copy">
        <div className="winner-coupon">{winner.assignedCoupon}</div>
      </div>

      <div className="winner-ticket" aria-live="polite">
        <div className="ticket-coupon-panel">
          <div className="ticket-coupon-label">COUPON NO.</div>
          <div className="ticket-coupon-number"><span>{winner.assignedCoupon}</span></div>
          <div className="ticket-ornament">✦</div>
        </div>

        <div className="ticket-details-panel">
          <div className="ticket-round-pill round-pill">WINNER {round} / {NUMBER_OF_WINNERS}</div>
          <div className="ticket-corner ticket-corner-tl">✿</div>
          <div className="ticket-corner ticket-corner-tr">✿</div>
          <div className="ticket-corner ticket-corner-bl">✿</div>
          <div className="ticket-corner ticket-corner-br">✿</div>

          <div className="ticket-congratulations">
            <span />
            CONGRATULATIONS!
            <span />
          </div>

          <h2>{winner.name}</h2>

          <div className="ticket-divider">✦</div>

          <div className="ticket-flat">
            <div className="ticket-flat-icon">⌂</div>
            <div>
              <small>FLAT NO.</small>
              <strong>{winner.flat}</strong>
            </div>
          </div>
        </div>
      </div>

      <button className="gold-button winner-next-button" onClick={onNext}>
        {round < NUMBER_OF_WINNERS ? 'NEXT WINNER' : 'SHOW ALL WINNERS'}
        <span>→</span>
      </button>
    </section>
  );
}

function FinalWinners({ winners, onReset }) {
  return (
    <section className="final-view">
      <div className="eyebrow">THE MOMENT IS YOURS</div>
      <h1>Tonight's <em>winners</em></h1>
      <p>Three names. One unforgettable moment.</p>
      <div className="winner-grid">
        {winners.map((w, i) => <article className="winner-card" key={`${w.assignedCoupon}-${i}`}><small>WINNER 0{i + 1}</small><div>{w.assignedCoupon}</div><h3>{w.name}</h3><p>FLAT {w.flat}</p></article>)}
      </div>
      <button className="gold-button" onClick={onReset}>RUN AGAIN</button>
    </section>
  );
}

export default App;
