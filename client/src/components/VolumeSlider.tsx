import { useEffect, useRef, useState } from 'react';
import { getVolume, setVolume } from '../lib/sound.js';

export default function VolumeSlider() {
  const [volume, setVolumeState] = useState(() => getVolume());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleChange(value: number) {
    setVolumeState(value);
    setVolume(value);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors"
        title="Volume des effets sonores"
        aria-label="Volume des effets sonores"
        aria-expanded={open}
      >
        <span className="text-sm select-none">{volume === 0 ? '🔇' : '🔊'}</span>
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg shadow-black/30 p-3 flex flex-col items-center gap-1.5"
          style={{ animation: 'fadeSlideIn 0.15s ease-out' }}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => handleChange(Number(e.target.value) / 100)}
            className="w-1.5 h-20 accent-emerald-500 cursor-pointer"
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
            aria-label="Volume des effets sonores"
          />
          <span className="text-[10px] text-zinc-500 select-none">{Math.round(volume * 100)}%</span>
        </div>
      )}
    </div>
  );
}
