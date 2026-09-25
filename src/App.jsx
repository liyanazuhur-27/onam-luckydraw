import React, { useEffect, useRef, useState } from 'react';
import {
  drawOneWinner,
  prepareExcel,
  removeWinnerFromPool,
  NUMBER_OF_WINNERS,
} from './drawEngine';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function App() {
  const [screen, setScreen] = useState('upload');
  const [prepared, setPrepared] = useState(null);
  const [remaining, setRemaining] = useState([]);
  const [winners, setWinners] = useState([]);
  const [pendingWinner, setPendingWinner] = useState(null);
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
  const digitAdvanceRef = useRef(null);

  const currentWinner =
    state === 'winner'
      ? winners[winners.length - 1] ?? null
      : null;

  function waitForNextDigit() {
    return new Promise((resolve) => {
      digitAdvanceRef.current = resolve;
    });
  }

  function releaseNextDigit() {
    if (!digitAdvanceRef.current) return;

    const resolve = digitAdvanceRef.current;
    digitAdvanceRef.current = null;
    resolve();
  }

  useEffect(() => {
    const handleKey = (e) => {
      const key = e.key.toLowerCase();

      if (screen === 'review' && e.key === 'ArrowLeft') {
        e.preventDefault();
        setScreen('upload');
        return;
      }

      if (['INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (key === 'f') toggleFullscreen();
      if (key === 'm') setMuted((value) => !value);

      if (screen === 'review' && key === 'enter' && prepared) {
        setScreen('stage');
        return;
      }

      if (screen !== 'stage') return;

      if (key === 'r') {
        resetShow();
        return;
      }

      if (e.code !== 'Space') return;

      e.preventDefault();

      if (state === 'ready') {
        runDraw();
      } else if (state === 'awaiting-digit') {
        releaseNextDigit();
      } else if (state === 'awaiting-reveal') {
        revealWinner();
      } else if (state === 'winner') {
        nextWinner();
      }
    };

    window.addEventListener('keydown', handleKey);

    return () =>
      window.removeEventListener('keydown', handleKey);
  });

  useEffect(() => {
    const listener = () =>
      setFull(Boolean(document.fullscreenElement));

    document.addEventListener(
      'fullscreenchange',
      listener
    );

    return () =>
      document.removeEventListener(
        'fullscreenchange',
        listener
      );
  }, []);

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant',
    });

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
      setPendingWinner(null);
      setRound(1);
      setReels(
        Array(data.couponWidth).fill('0')
      );
      setLocked(
        Array(data.couponWidth).fill(false)
      );
      setState('ready');
      setStatus('FINAL DRAW DATA READY');
      setSubstatus(
        'Review the pool, then enter stage mode.'
      );
      setScreen('review');
    } catch (err) {
      setPrepared(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Could not read the Excel file.'
      );
    }
  }

  function audioContext() {
    if (muted) return null;

    if (!audioRef.current) {
      audioRef.current =
        new window.AudioContext();
    }

    if (
      audioRef.current.state === 'suspended'
    ) {
      audioRef.current.resume();
    }

    return audioRef.current;
  }

  function tone(
    frequency,
    duration = 0.08,
    type = 'sine'
  ) {
    const ctx = audioContext();

    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(
      0.0001,
      ctx.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.09,
      ctx.currentTime + 0.01
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + duration
    );

    osc.connect(gain).connect(ctx.destination);

    osc.start();
    osc.stop(
      ctx.currentTime +
        duration +
        0.02
    );
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  function enterStage() {
    setState('ready');

    setReels(
      prepared
        ? Array(prepared.couponWidth).fill('0')
        : []
    );

    setLocked(
      prepared
        ? Array(prepared.couponWidth).fill(false)
        : []
    );

    setStatus('READY FOR THE FIRST DRAW');
    setSubstatus('Press SPACE to begin');
    setScreen('stage');
  }

  function resetShow() {
    if (!prepared) return;

    releaseNextDigit();

    setRemaining(prepared.participants);
    setWinners([]);
    setPendingWinner(null);
    setRound(1);

    setReels(
      Array(prepared.couponWidth).fill('0')
    );

    setLocked(
      Array(prepared.couponWidth).fill(false)
    );

    setState('ready');
    setStatus('READY FOR THE FIRST DRAW');
    setSubstatus('Press SPACE to begin');
  }

  async function spinTo(index, finalDigit) {
    /*
     * The reel starts fast and progressively slows down.
     * Later digits take longer to settle, keeping the final
     * coupon reveal deliberate and readable.
     */
    const total = 30 + index * 4;
    const startDelay = 56;
    const endDelay = 240;

    for (let i = 0; i < total; i += 1) {
      const progress =
        i / Math.max(1, total - 1);

      const interval =
        startDelay *
        Math.pow(
          endDelay / startDelay,
          progress
        );

      setReels((current) =>
        current.map((value, position) =>
          position === index
            ? String(
                (Number(value) + 1) % 10
              )
            : value
        )
      );

      if (i % 2 === 0) {
        tone(
          145 +
            index * 28 +
            (i % 6) * 7,
          0.035,
          'square'
        );
      }

      await wait(interval);
    }

    setReels((current) =>
      current.map((value, position) =>
        position === index
          ? finalDigit
          : value
      )
    );

    setLocked((current) =>
      current.map((value, position) =>
        position === index
          ? true
          : value
      )
    );

    tone(
      350 + index * 80,
      0.16,
      'triangle'
    );

    await wait(1050);
  }

  async function runDraw() {
    if (
      !prepared ||
      !remaining.length ||
      state !== 'ready'
    ) {
      return;
    }

    audioContext();

    setState('countdown');
    setStatus(
      `WINNER ${round} / ${NUMBER_OF_WINNERS}`
    );
    setSubstatus('Get ready…');

    setLocked(
      Array(prepared.couponWidth).fill(false)
    );

    setReels(
      Array(prepared.couponWidth).fill('0')
    );

    tone(
      210,
      0.14,
      'triangle'
    );

    await wait(650);

    tone(
      265,
      0.14,
      'triangle'
    );

    await wait(650);

    setState('spinning');

    setSubstatus(
      'Every digit is being selected from the live eligible pool.'
    );

    const result =
      await drawOneWinner(
        remaining,
        prepared.couponWidth,
        async (step) => {
          await spinTo(
            step.position - 1,
            step.digit
          );

          const isLastDigit =
            step.position ===
            step.totalDigits;

          if (isLastDigit) {
            return;
          }

          setState('awaiting-digit');

          setStatus(
            `DIGIT ${step.position} LOCKED`
          );

          setSubstatus(
            'PRESS SPACE TO REVEAL THE NEXT DIGIT'
          );

          await waitForNextDigit();

          setState('spinning');

          setStatus(
            `WINNER ${round} / ${NUMBER_OF_WINNERS}`
          );

          setSubstatus(
            `${step.candidatesRemaining} possible coupons remain.`
          );

          await wait(220);
        }
      );

    const winner = result.winner;

    /*
     * The winner is now known, but deliberately NOT revealed.
     * We hold the final number on screen until the operator
     * presses SPACE.
     */
    setPendingWinner(winner);
    setRemaining((current) =>
      removeWinnerFromPool(
        current,
        winner
      )
    );

    setState('awaiting-reveal');
    setStatus('FINAL NUMBER LOCKED');
    setSubstatus(
      'PRESS SPACE TO REVEAL THE WINNER'
    );

    tone(
      523,
      0.22,
      'triangle'
    );
  }

  function revealWinner() {
    if (
      !pendingWinner ||
      state !== 'awaiting-reveal'
    ) {
      return;
    }

    setWinners((current) => [
      ...current,
      pendingWinner,
    ]);

    setState('winner');
    setStatus('WE HAVE A WINNER');
    setSubstatus(
      `${pendingWinner.name} • Flat ${pendingWinner.flat}`
    );
  }

  function playWinnerRevealSound() {
    if (muted) return;

    const ctx = audioContext();

    if (!ctx) return;

    const now = ctx.currentTime;

    const sweep =
      ctx.createOscillator();

    const sweepGain =
      ctx.createGain();

    sweep.type = 'sine';

    sweep.frequency.setValueAtTime(
      220,
      now
    );

    sweep.frequency.exponentialRampToValueAtTime(
      720,
      now + 0.8
    );

    sweepGain.gain.setValueAtTime(
      0.0001,
      now
    );

    sweepGain.gain.exponentialRampToValueAtTime(
      0.07,
      now + 0.12
    );

    sweepGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.9
    );

    sweep
      .connect(sweepGain)
      .connect(ctx.destination);

    sweep.start(now);
    sweep.stop(now + 0.94);

    [392, 494, 587].forEach(
      (frequency, index) => {
        const osc =
          ctx.createOscillator();

        const gain =
          ctx.createGain();

        const start =
          now +
          0.42 +
          index * 0.12;

        osc.type = 'triangle';
        osc.frequency.value = frequency;

        gain.gain.setValueAtTime(
          0.0001,
          start
        );

        gain.gain.exponentialRampToValueAtTime(
          0.085,
          start + 0.025
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          start + 0.75
        );

        osc
          .connect(gain)
          .connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.78);
      }
    );
  }

  function nextWinner() {
    if (
      round >= NUMBER_OF_WINNERS
    ) {
      setPendingWinner(null);
      setState('complete');
      setStatus(
        "TONIGHT'S WINNERS"
      );
      setSubstatus(
        'Three names. One unforgettable moment.'
      );
      return;
    }

    setPendingWinner(null);

    setRound((value) => value + 1);

    setState('ready');

    setReels(
      Array(prepared.couponWidth).fill('0')
    );

    setLocked(
      Array(prepared.couponWidth).fill(false)
    );

    setStatus(
      `WINNER ${
        round + 1
      } / ${NUMBER_OF_WINNERS}`
    );

    setSubstatus(
      'Press SPACE to begin'
    );
  }

  return (
    <div
      className={`app ${
        screen !== 'stage'
          ? 'admin-mode'
          : 'stage-mode'
      }`}
    >
      <Background />

      {screen === 'upload' ? (
        <UploadScreen
          error={error}
          onUpload={upload}
        />
      ) : screen === 'review' ? (
        <ReviewScreen
          prepared={prepared}
          onEnter={enterStage}
          onBack={() =>
            setScreen('upload')
          }
        />
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
          pendingWinner={pendingWinner}
          muted={muted}
          full={full}
          onMute={() =>
            setMuted((value) => !value)
          }
          onFull={toggleFullscreen}
          onStart={runDraw}
          onReveal={revealWinner}
          onNext={nextWinner}
          onReset={resetShow}
          onRevealSound={
            playWinnerRevealSound
          }
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
      <div
        className="pookalam"
        aria-hidden="true"
      />
      <div
        className="floating-petals"
        aria-hidden="true"
      >
        {Array.from(
          { length: 8 },
          (_, index) => (
            <span key={index} />
          )
        )}
      </div>
    </>
  );
}

function AdminHeader({
  compact = false,
}) {
  return (
    <div
      className={`admin-header ${
        compact ? 'compact' : ''
      }`}
    >
      <div className="brand">
        <span className="brand-logo-wrap">
          <img
            src="/assets/mj-logo.png"
            alt="MJ Lifestyle Amadeus"
            className="brand-logo"
          />
        </span>
        <img
          src="/assets/mj-wordmark.png"
          alt="MJ Lifestyle Amadeus Lucky Draw"
          className="brand-wordmark"
        />
      </div>

      <div className="eyebrow">
        A BRIGHTER NEIGHBOURHOOD TOGETHER
      </div>
    </div>
  );
}

function UploadScreen({
  error,
  onUpload,
}) {
  return (
    <main className="admin upload-screen">
      <div className="admin-card upload-card">
        <AdminHeader />

        <div className="upload-copy">
          <div className="eyebrow">
            FINAL EVENT DATA
          </div>

          <h1>
            Load the{' '}
            <em>lucky draw</em>
          </h1>

          <p className="lead">
            Upload the final Excel from{' '}
            <strong>Coupon Master</strong>.
            Once loaded, the app prepares
            the exact pool that will be used
            on stage.
          </p>
        </div>

        <label className="dropzone">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) =>
              onUpload(
                event.target.files?.[0]
              )
            }
          />

          <div className="upload-symbol">
            ✦
          </div>

          <div className="upload-title">
            Drop your Excel here
          </div>

          <div className="upload-help">
            or click to browse • .xlsx /
            .xls / .csv
          </div>
        </label>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <div className="hint upload-hint">
          The final file stays in this
          browser session. &nbsp;•&nbsp;
          ENTER after loading opens the
          review screen.
        </div>
      </div>
    </main>
  );
}

function ReviewScreen({
  prepared,
  onEnter,
  onBack,
}) {
  if (!prepared) return null;

  return (
    <main className="admin review-screen">
      <div className="review-shell">
        <div className="review-topbar">
          <button
            className="back-button"
            onClick={onBack}
            title="Back to upload"
          >
            ← <span>UPLOAD FILE</span>
          </button>

          <AdminHeader compact />

          <div className="review-ready">
            FINAL DRAW DATA READY
          </div>
        </div>

        <section className="review-hero">
          <div>
            <div className="eyebrow">
              DATA CHECK COMPLETE
            </div>

            <h1>
              Everything is{' '}
              <em>ready</em>
            </h1>

            <p className="lead">
              The pool below is frozen for
              the event. Test coupons are
              excluded and duplicate coupon
              numbers have been reassigned
              without losing the original
              ownership trail.
            </p>
          </div>

          <div className="review-shortcut">
            ← back to upload &nbsp;•&nbsp;
            ENTER stage mode
          </div>
        </section>

        <section className="summary review-summary">
          <div className="summary-grid">
            <Stat
              label="Rows loaded"
              value={prepared.sourceRows}
            />

            <Stat
              label="Test removed"
              value={
                prepared.testCouponsRemoved
              }
            />

            <Stat
              label="Duplicates resolved"
              value={
                prepared
                  .duplicateChanges.length
              }
            />

            <Stat
              label="Final coupons"
              value={
                prepared.participants.length
              }
            />
          </div>
        </section>

        <section className="review-bottom">
          <div className="changes changes-review">
            <div className="changes-heading">
              <b>
                Duplicate reassignments
              </b>

              <span>
                {
                  prepared
                    .duplicateChanges.length
                }{' '}
                total
              </span>
            </div>

            <div className="changes-list">
              {prepared
                .duplicateChanges.length ===
              0 ? (
                <div className="no-changes">
                  No duplicate coupon
                  numbers were found.
                </div>
              ) : (
                prepared.duplicateChanges
                  .slice(0, 7)
                  .map((change) => (
                    <div
                      className="change-row"
                      key={change.excelRow}
                    >
                      <span className="change-number">
                        {
                          change.originalCoupon
                        }{' '}
                        →{' '}
                        {
                          change.assignedCoupon
                        }
                      </span>

                      <span className="change-person">
                        {change.name} •{' '}
                        {change.flat}
                      </span>
                    </div>
                  ))
              )}

              {prepared
                .duplicateChanges.length >
                7 && (
                <div className="more-row">
                  +{' '}
                  {prepared
                    .duplicateChanges.length -
                    7}{' '}
                  more reassignments
                </div>
              )}
            </div>
          </div>

          <div className="review-action-card">
            <div className="review-action-label">
              EVENT MODE
            </div>

            <strong>
              {prepared.participants.length}{' '}
              coupons
            </strong>

            <span>
              3 winners • one person can win
              only once
            </span>

            <button
              className="gold-button"
              onClick={onEnter}
            >
              ENTER STAGE MODE{' '}
              <span>→</span>
            </button>
          </div>
        </section>

        <div className="review-footer-hint">
          ← BACK &nbsp;•&nbsp; ENTER STAGE
          MODE &nbsp;•&nbsp; F FULLSCREEN
          &nbsp;•&nbsp; M SOUND
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StageScreen({
  remaining,
  winners,
  round,
  state,
  reels,
  locked,
  status,
  substatus,
  currentWinner,
  pendingWinner,
  muted,
  full,
  onMute,
  onFull,
  onStart,
  onReveal,
  onNext,
  onReset,
  onRevealSound,
}) {
  return (
    <main
      className={`stage stage-state-${state}`}
    >
      <header className="stage-top">
        <div className="brand">
          <span className="brand-logo-wrap">
            <img
              src="/assets/mj-logo.png"
              alt="MJ Lifestyle Amadeus"
              className="brand-logo"
            />
          </span>
          <img
            src="/assets/mj-wordmark.png"
            alt="MJ Lifestyle Amadeus Lucky Draw"
            className="brand-wordmark"
          />
        </div>

        <div className="event-logo">
          <img
            src="/assets/onamadhuram.png"
            alt="Onamadhuram 4.0"
          />
        </div>

        <div className="top-actions">
          <span>
            {remaining.length} coupons
            remaining
          </span>

          <button onClick={onMute}>
            {muted
              ? 'SOUND OFF'
              : 'SOUND ON'}
          </button>

          <button onClick={onFull}>
            {full
              ? 'EXIT FULLSCREEN'
              : 'FULLSCREEN'}
          </button>
        </div>
      </header>

      <div className="stage-body">
        {state === 'complete' ? (
          <FinalWinners
            winners={winners}
            onReset={onReset}
          />
        ) : state === 'winner' &&
          currentWinner ? (
          <WinnerReveal
            winner={currentWinner}
            round={round}
            onNext={onNext}
            onRevealSound={
              onRevealSound
            }
          />
        ) : (
          <DrawView
            reels={reels}
            locked={locked}
            state={state}
            round={round}
            status={status}
            substatus={substatus}
            pendingWinner={pendingWinner}
            onStart={onStart}
            onReveal={onReveal}
          />
        )}
      </div>

      <footer className="stage-bottom">
        <span>
          SPACE start / next digit / reveal
          winner / next winner • R reset • F
          fullscreen • M mute
        </span>

        {winners.length > 0 && (
          <span>
            {winners.length} winner
            {winners.length > 1
              ? 's'
              : ''}{' '}
            selected
          </span>
        )}
      </footer>
    </main>
  );
}

function DrawView({
  reels,
  locked,
  state,
  round,
  status,
  substatus,
  onStart,
  onReveal,
}) {
  const isAwaitingReveal =
    state === 'awaiting-reveal';

  return (
    <section
      className={`draw-view ${
        isAwaitingReveal
          ? 'awaiting-reveal-view'
          : ''
      }`}
    >
      <div className="round-pill">
        WINNER {round} /{' '}
        {NUMBER_OF_WINNERS}
      </div>

      

      <h1>
        {isAwaitingReveal ? (
          <>
            The lucky number is{' '}
            <em>{reels.join('')}</em>
          </>
        ) : (
          <>
            Find the{' '}
            <em>lucky number</em>
          </>
        )}
      </h1>

      <div className="reel-deck">
        {reels.map(
          (digit, index) => (
            <div
              className={`reel-wrap ${
                locked[index]
                  ? 'is-locked'
                  : ''
              }`}
              key={index}
            >
              <div
                className={`reel ${
                  state === 'spinning' ||
                  state === 'countdown'
                    ? 'is-spinning'
                    : ''
                }`}
              >
                <div className="fade-top" />
                <div className="fade-bottom" />

                <div className="reel-line line-top" />
                <div className="reel-line line-bottom" />

                <div className="ghost ghost-top">
                  {(Number(digit) + 9) % 10}
                </div>

                <div
                  className="main-digit"
                  key={`${index}-${digit}`}
                >
                  <span>{digit}</span>
                </div>

                <div className="ghost ghost-bottom">
                  {(Number(digit) + 1) % 10}
                </div>
              </div>

              <div className="lock-label">
                {locked[index]
                  ? 'LOCKED'
                  : 'SPINNING'}
              </div>
            </div>
          )
        )}
      </div>

      <div className="draw-status">
        <span />
        {status}
      </div>

      {substatus && (
        <div className="draw-substatus">
          {substatus}
        </div>
      )}

      {state === 'ready' && (
        <button
          className="gold-button start"
          onClick={onStart}
        >
          START DRAW <b>SPACE</b>{' '}
          <span>→</span>
        </button>
      )}

      {state === 'countdown' && (
        <div className="countdown">
          Get ready…
        </div>
      )}

      {state === 'spinning' && (
        <div className="spin-note">
          The reels are deciding…
        </div>
      )}

      {state === 'awaiting-digit' && (
        <div className="spin-note next-digit-note">
          PRESS <b>SPACE</b> FOR NEXT DIGIT
        </div>
      )}

      {state === 'awaiting-reveal' && (
        <button
          className="gold-button reveal-winner-button"
          onClick={onReveal}
        >
          REVEAL WINNER{' '}
          <b>SPACE</b>{' '}
          <span>→</span>
        </button>
      )}
    </section>
  );
}

function WinnerReveal({
  winner,
  round,
  onNext,
  onRevealSound,
}) {
  const [revealDetails, setRevealDetails] =
    useState(false);

  const [revealPrize, setRevealPrize] =
    useState(false);

  const isFirstPrize = round === 1;

  useEffect(() => {
    setRevealDetails(false);
    setRevealPrize(false);

    const detailsTimer =
      window.setTimeout(() => {
        setRevealDetails(true);
        onRevealSound?.();
      }, 700);

    const prizeTimer =
      window.setTimeout(() => {
        setRevealPrize(true);
      }, 2300);

    return () => {
      window.clearTimeout(detailsTimer);
      window.clearTimeout(prizeTimer);
    };
  }, [winner, onRevealSound]);

  return (
    <section
      className={`winner-reveal ${
        revealDetails
          ? 'winner-details-visible'
          : ''
      }`}
    >
      <div className="winner-halo" />

      <div className="winner-ticket">
        <div className="ticket-details-panel">
          <div className="ticket-winner-heading">
            ✦ WE HAVE A WINNER ✦
          </div>

          <div className="ticket-round-pill round-pill">
            WINNER {round} /{' '}
            {NUMBER_OF_WINNERS}
          </div>

          <div className="ticket-congratulations">
            <span />
            CONGRATULATIONS!
            <span />
          </div>

          <h2>{winner.name}</h2>

          <div className="ticket-divider">
            ✦
          </div>

          <div className="ticket-flat">
            <div className="ticket-flat-icon">
              ⌂
            </div>

            <div>
              <small>FLAT NO.</small>
              <strong>
                {winner.flat}
              </strong>
            </div>
          </div>

          <div className="ticket-coupon-detail">
            <small>COUPON NUMBER</small>
            <strong>
              {winner.assignedCoupon}
            </strong>
          </div>
        </div>

        <div className="prize-panel">
          <div className="prize-panel-title">
            {isFirstPrize
              ? 'THE FIRST PRIZE'
              : 'THE GRAND PRIZE'}
          </div>

          <div className={`prize-frame ${revealPrize ? "winner-prize-visible" : ""}`}>
            <div className="prize-curtain" aria-hidden="true" />
            <div className="prize-glow" aria-hidden="true" />
            {isFirstPrize ? (
              <>
                <img
                  src="/assets/octopus-fitness.png"
                  alt="Octopus Fitness Club"
                  className="prize-logo"
                />

                <div className="prize-name">
                  GYM MEMBERSHIP
                </div>

                <div className="prize-caption">
                  OCTOPUS FITNESS CLUB
                </div>
              </>
            ) : (
              <>
                <div className="prize-placeholder-icon">
                  ✦
                </div>

                <div className="prize-name">
                  YOUR PRIZE
                </div>

                <div className="prize-caption">
                  Prize image goes here
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <button
        className="gold-button winner-next-button"
        onClick={onNext}
      >
        {round < NUMBER_OF_WINNERS
          ? 'NEXT WINNER'
          : 'SHOW ALL WINNERS'}
        <span>→</span>
      </button>
    </section>
  );
}

function FinalWinners({
  winners,
  onReset,
}) {
  return (
    <section className="final-view">
      <div className="eyebrow">
        THE MOMENT IS YOURS
      </div>

      <h1>
        Tonight's{' '}
        <em>winners</em>
      </h1>

      <p>
        Three names. One unforgettable
        moment.
      </p>

      <div className="winner-grid">
        {winners.map(
          (winner, index) => (
            <article
              className="winner-card"
              key={`${winner.assignedCoupon}-${index}`}
            >
              <small>
                WINNER 0{index + 1}
              </small>

              <div>
                {winner.assignedCoupon}
              </div>

              <h3>{winner.name}</h3>

              <p>
                FLAT {winner.flat}
              </p>
            </article>
          )
        )}
      </div>

      <button
        className="gold-button"
        onClick={onReset}
      >
        RUN AGAIN
      </button>
    </section>
  );
}

export default App;
