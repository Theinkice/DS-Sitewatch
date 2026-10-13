import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX } from 'lucide-react';

function playTone(contextRef, frequency, duration = 0.06, volume = 0.018, type = 'sine') {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = contextRef.current || (contextRef.current = new AudioContextClass());
    if (context.state === 'suspended') context.resume().catch(() => {});

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  } catch {
    // Audio is an optional interface effect; unavailable audio must not affect navigation.
  }
}

export default function AmbientEffects() {
  const cursorRef = useRef(null);
  const trailDotsRef = useRef([]);
  const pointerPositionRef = useRef(null);
  const cursorClickTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const musicAudioRef = useRef(null);
  const soundEnabledRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => {
    const music = new Audio('/audio/kiss-the-rain.mp3');
    music.loop = true;
    music.preload = 'metadata';
    music.volume = 0.3;
    musicAudioRef.current = music;

    return () => {
      music.pause();
      musicAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    const music = musicAudioRef.current;
    if (!music) return;
    if (soundEnabled) {
      music.play().catch(() => {});
    } else {
      music.pause();
      music.currentTime = 0;
    }
  }, [soundEnabled]);

  useEffect(() => {
    const pointerMedia = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!pointerMedia.matches) return undefined;

    const handlePointerMove = (event) => {
      if (event.pointerType === 'touch' || !cursorRef.current) return;
      const previous = pointerPositionRef.current;
      const deltaX = previous ? event.clientX - previous.x : 1;
      const deltaY = previous ? event.clientY - previous.y : 1;
      const distance = Math.hypot(deltaX, deltaY) || 1;
      const directionX = deltaX / distance;
      const directionY = deltaY / distance;
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      cursorRef.current.style.left = `${event.clientX}px`;
      cursorRef.current.style.top = `${event.clientY}px`;
      cursorRef.current.classList.add('is-visible');
      trailDotsRef.current.forEach((dot, index) => {
        if (!dot) return;
        const spacing = (index + 1) * 5;
        dot.style.transform = `translate(${6 - directionX * spacing}px, ${6 - directionY * spacing}px) scale(${1 - index * 0.18})`;
      });
      const interactive = event.target?.closest?.('a, button, [role="button"], input, select, textarea, .cursor-pointer');
      cursorRef.current.classList.toggle('is-interactive', Boolean(interactive));
    };

    const handlePointerDown = (event) => {
      if (event.pointerType !== 'mouse' || !cursorRef.current) return;
      cursorRef.current.classList.add('is-clicking');
      window.clearTimeout(cursorClickTimerRef.current);
      cursorClickTimerRef.current = window.setTimeout(() => {
        cursorRef.current?.classList.remove('is-clicking');
      }, 240);
    };

    const handlePointerLeave = () => {
      cursorRef.current?.classList.remove('is-visible', 'is-interactive', 'is-clicking');
      pointerPositionRef.current = null;
    };

    const handlePointerOut = (event) => {
      const outsideViewport = event.clientX < 0 || event.clientY < 0
        || event.clientX > window.innerWidth || event.clientY > window.innerHeight;
      if (!event.relatedTarget && outsideViewport) handlePointerLeave();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('blur', handlePointerLeave);
    document.addEventListener('pointerout', handlePointerOut);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('blur', handlePointerLeave);
      document.removeEventListener('pointerout', handlePointerOut);
      window.clearTimeout(cursorClickTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handlePointerOver = (event) => {
      if (!soundEnabledRef.current || event.pointerType !== 'mouse') return;
      const control = event.target?.closest?.('a, button, [role="button"], input, select, textarea, .cursor-pointer');
      if (!control || control.matches('[data-sound-toggle]') || control.contains(event.relatedTarget)) return;
      playTone(audioContextRef, 740, 0.045, 0.008, 'sine');
    };

    const handleClick = (event) => {
      if (!soundEnabledRef.current) return;
      const music = musicAudioRef.current;
      if (music?.paused) music.play().catch(() => {});
      const control = event.target?.closest?.('a, button, [role="button"], input, select, textarea, .cursor-pointer');
      if (!control || control.matches('[data-sound-toggle]') || control.disabled) return;
      playTone(audioContextRef, 520, 0.075, 0.022, 'sine');
      window.setTimeout(() => playTone(audioContextRef, 780, 0.055, 0.012, 'sine'), 35);
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('click', handleClick, true);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const toggleSound = () => {
    setSoundEnabled((enabled) => {
      const next = !enabled;
      soundEnabledRef.current = next;
      if (next) {
        musicAudioRef.current?.play().catch(() => {});
        playTone(audioContextRef, 587, 0.09, 0.025, 'sine');
        window.setTimeout(() => playTone(audioContextRef, 880, 0.12, 0.018, 'sine'), 65);
      } else if (musicAudioRef.current) {
        musicAudioRef.current.pause();
        musicAudioRef.current.currentTime = 0;
      }
      return next;
    });
  };

  const SoundIcon = soundEnabled ? Volume2 : VolumeX;

  return (
    <>
      {createPortal(
        <div ref={cursorRef} className="pointer-aura" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              ref={(node) => { trailDotsRef.current[index] = node; }}
              className={`pointer-aura__trail-dot pointer-aura__trail-dot--${index + 1}`}
            />
          ))}
          <span className="pointer-aura__core" />
        </div>,
        document.body,
      )}
      <button
        type="button"
        data-sound-toggle
        className={`ambient-sound-toggle ${soundEnabled ? 'is-on' : ''}`}
        onClick={toggleSound}
        aria-label={soundEnabled ? '关闭背景音乐与界面音效' : '开启背景音乐与界面音效'}
        aria-pressed={soundEnabled}
        title={soundEnabled ? '关闭背景音乐与界面音效' : '开启背景音乐与界面音效'}
      >
        <SoundIcon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>SOUND</span>
        <span className="ambient-sound-toggle__state">{soundEnabled ? 'ON' : 'OFF'}</span>
      </button>
    </>
  );
}
