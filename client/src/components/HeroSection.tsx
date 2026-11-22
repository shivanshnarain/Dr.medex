import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Cpu, Award } from "lucide-react";
import redEcgPulseImage from "../assets/ecg-pulse-red.png";

interface HeroSectionProps {
  onOpenQuote?: (productTitle?: string) => void;
  onQuickView?: (productId?: string) => void;
}

interface HeroCategorySlide {
  id: string;
  categoryLabel: string;
  imageUrl: string;
  fallbackUrl: string;
  categoryPath: string;
}

const HERO_CATEGORY_SLIDES: HeroCategorySlide[] = [
  {
    id: "electrosurgical-equipment",
    categoryLabel: "ELECTRO SURGICAL EQUIPMENT",
    imageUrl:
      "https://res.cloudinary.com/mjqna8qi/image/upload/v1795329929/dr-medex/hero-showcase/01-electrosurgical-equipment.png",
    fallbackUrl: "/hero-showcase/01-electrosurgical-equipment.png",
    categoryPath: "/category/electrosurgical-units",
  },
  {
    id: "cryosurgical-equipment",
    categoryLabel: "CRYO SURGICAL EQUIPMENT",
    imageUrl:
      "https://res.cloudinary.com/mjqna8qi/image/upload/v1795329931/dr-medex/hero-showcase/02-cryosurgical-equipment.png",
    fallbackUrl: "/hero-showcase/02-cryosurgical-equipment.png",
    categoryPath: "/category/cryo-surgical",
  },
  {
    id: "ot-lights-equipment",
    categoryLabel: "OT LIGHTS EQUIPMENT",
    imageUrl:
      "https://res.cloudinary.com/mjqna8qi/image/upload/v1795329932/dr-medex/hero-showcase/03-ot-lights-equipment.png",
    fallbackUrl: "/hero-showcase/03-ot-lights-equipment.png",
    categoryPath: "/category/ot-lights",
  },
  {
    id: "ot-tables-equipment",
    categoryLabel: "OT TABLES EQUIPMENT",
    imageUrl:
      "https://res.cloudinary.com/mjqna8qi/image/upload/v1795329933/dr-medex/hero-showcase/04-ot-tables-equipment.png",
    fallbackUrl: "/hero-showcase/04-ot-tables-equipment.png",
    categoryPath: "/category/examination-ot-tables",
  },
  {
    id: "obg-equipment",
    categoryLabel: "OBG EQUIPMENT",
    imageUrl:
      "https://res.cloudinary.com/mjqna8qi/image/upload/v1795329934/dr-medex/hero-showcase/05-obg-equipment.png",
    fallbackUrl: "/hero-showcase/05-obg-equipment.png",
    categoryPath: "/category/obstetrics-and-gynaecology",
  },
  {
    id: "general-medical-equipment",
    categoryLabel: "GENERAL MEDICAL EQUIPMENT",
    imageUrl:
      "https://res.cloudinary.com/mjqna8qi/image/upload/v1795329935/dr-medex/hero-showcase/06-general-medical-equipment.png",
    fallbackUrl: "/hero-showcase/06-general-medical-equipment.png",
    categoryPath: "/category/medical-equipment",
  },
];

export const HeroSection: React.FC<HeroSectionProps> = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isManualPause, setIsManualPause] = useState(false);
  const [isTabHidden, setIsTabHidden] = useState(false);
  const [isMainCardZoomed, setIsMainCardZoomed] = useState(false);
  const manualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const [cardsVisible, setCardsVisible] = useState(false);
  const cardsContainerRef = useRef<HTMLDivElement>(null);

  // Exact matching width for Row 1 (ADVANCED + MEDICAL) and Row 3 (BETTER CARE + ECG LOGO)
  const row1Ref = useRef<HTMLDivElement>(null);
  const [row1Width, setRow1Width] = useState<number | null>(null);

  useEffect(() => {
    const el = row1Ref.current;
    if (!el) return;
    const updateWidth = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setRow1Width(w);
    };
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  useEffect(() => {
    const node = cardsContainerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setCardsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setCardsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Reset image zoom state when category slide changes
  useEffect(() => {
    setIsMainCardZoomed(false);
  }, [activeIndex]);

  // Preload next image to eliminate flicker during rotation
  useEffect(() => {
    const nextIdx = (activeIndex + 1) % HERO_CATEGORY_SLIDES.length;
    const img = new Image();
    img.src = HERO_CATEGORY_SLIDES[nextIdx].imageUrl;
  }, [activeIndex]);

  // Tab visibility listener to pause/resume cleanly
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabHidden(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Automatic image rotation: natural continuous flow every 4.5 seconds (4500ms)
  useEffect(() => {
    // Respect prefers-reduced-motion
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    if (isHovered || isManualPause || isTabHidden) return;

    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % HERO_CATEGORY_SLIDES.length);
    }, 4500);

    return () => clearInterval(interval);
  }, [isHovered, isManualPause, isTabHidden]);

  // Reset manual pause timer and resume autoplay after 4.5s idle
  const resetManualTimer = useCallback(() => {
    setIsManualPause(true);
    if (manualTimerRef.current) {
      clearTimeout(manualTimerRef.current);
    }
    manualTimerRef.current = setTimeout(() => {
      setIsManualPause(false);
    }, 4500);
  }, []);

  // Next slide navigation with seamless looping
  const handleNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % HERO_CATEGORY_SLIDES.length);
    resetManualTimer();
  }, [resetManualTimer]);

  // Previous slide navigation with seamless looping
  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + HERO_CATEGORY_SLIDES.length) % HERO_CATEGORY_SLIDES.length);
    resetManualTimer();
  }, [resetManualTimer]);

  // Manual thumbnail selection: updates immediately and resumes auto-rotation from selected index
  const handleSelectThumbnail = useCallback((index: number) => {
    setActiveIndex(index);
    resetManualTimer();
  }, [resetManualTimer]);

  // Touch swipe gesture handlers for mobile showcase
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!e.touches || !e.touches[0]) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (
      touchStartXRef.current === null ||
      touchStartYRef.current === null ||
      !e.changedTouches ||
      !e.changedTouches[0]
    ) {
      touchStartXRef.current = null;
      touchStartYRef.current = null;
      return;
    }
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    // Detect horizontal swipe (> 35px threshold and greater than vertical movement)
    if (Math.abs(deltaX) > 35 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        // Swiped left -> next slide
        handleNext();
      } else {
        // Swiped right -> previous slide
        handlePrev();
      }
    }
  };

  useEffect(() => {
    return () => {
      if (manualTimerRef.current) {
        clearTimeout(manualTimerRef.current);
      }
    };
  }, []);

  const safeActiveIndex =
    typeof activeIndex === "number" && activeIndex >= 0 && activeIndex < HERO_CATEGORY_SLIDES.length
      ? activeIndex
      : 0;
  const activeSlide = HERO_CATEGORY_SLIDES[safeActiveIndex] || HERO_CATEGORY_SLIDES[0];

  // Exactly 3 secondary images displayed beside main image on desktop/tablet, cycling sequentially
  const secondaryIndices = [
    (safeActiveIndex + 1) % HERO_CATEGORY_SLIDES.length,
    (safeActiveIndex + 2) % HERO_CATEGORY_SLIDES.length,
    (safeActiveIndex + 3) % HERO_CATEGORY_SLIDES.length,
  ];

  return (
    <section
      className="relative w-full bg-white select-none pt-0 sm:pt-12 lg:pt-14 pb-12 sm:pb-16"
      aria-label="DR.MEDEX Hero Showcase"
    >
      <div className="max-w-[1400px] w-full mx-auto px-0 sm:px-6 lg:px-8">
        {/* TWO-COLUMN HERO SECTION: TEXT ON LEFT, SHOWCASE ON RIGHT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 lg:gap-10 xl:gap-12 items-center">

          {/* LEFT COLUMN: HERO CONTENT (ON THE LEFT) */}
          <div className="lg:col-span-5 flex flex-col items-start order-2 lg:order-1 px-4 sm:px-0">
            {/* Eyebrow text with dark-green text and matching dark-green dot */}
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#2D5A4A] mb-4 sm:mb-5">
              <span className="w-2 h-2 rounded-full bg-[#2D5A4A] shrink-0" />
              <span>TRUSTED MEDICAL EQUIPMENT PARTNER</span>
            </div>

            {/* Main Heading: Exactly THREE Lines */}
            <h1 className="text-3xl sm:text-4xl lg:text-[46px] xl:text-[50px] leading-[1.18] mb-3 sm:mb-4">
              {/* Line 1: ADVANCED MEDICAL (defines the exact target width) */}
              <div
                ref={row1Ref}
                className="w-fit inline-flex items-center gap-2 sm:gap-2.5 whitespace-nowrap tracking-[0.03em]"
              >
                <span className="font-extrabold not-italic text-black uppercase">
                  ADVANCED
                </span>{" "}
                <span
                  className="inline-flex items-center justify-center px-2.5 sm:px-3.5 py-0.5 rounded-lg sm:rounded-xl font-extrabold not-italic text-white uppercase tracking-[0.03em] shadow-xs"
                  style={{
                    background:
                      "linear-gradient(90deg, #7AA05A 0%, #2D5A4A 50%, #7AA05A 100%)",
                  }}
                >
                  MEDICAL
                </span>
              </div>

              {/* Line 2: Technology for entirely on the second line */}
              <span className="block font-light italic text-black tracking-[0.02em] mt-1 sm:mt-1.5">
                Technology for
              </span>

              {/* Line 3: BETTER CARE + RED ECG LOGO (matching Row 1 width with aligned edges) */}
              <div
                className="flex items-center justify-between gap-1.5 sm:gap-2.5 mt-1 sm:mt-1.5 max-w-full"
                style={{
                  width: row1Width ? `${row1Width}px` : "fit-content",
                }}
              >
                <span
                  className="font-extrabold not-italic uppercase tracking-[0.01em] shrink-0"
                  style={{ color: "#FD0000" }}
                >
                  BETTER CARE
                </span>

                {/* DR.MEDEX Red ECG Pulse Logo with subtle breathing & sweep animation */}
                <div className="relative flex items-center justify-end flex-1 min-w-0 ecg-animate-breathe overflow-hidden">
                  {/* Base ECG Logo */}
                  <img
                    src={redEcgPulseImage}
                    alt=""
                    aria-hidden="true"
                    className="block h-8 sm:h-10 lg:h-12 xl:h-13 w-auto max-w-full object-contain object-right select-none pointer-events-none"
                    loading="eager"
                    decoding="async"
                  />

                  {/* Moving light/sweep effect along the ECG pulse line */}
                  <div
                    className="absolute inset-0 pointer-events-none ecg-animate-sweep"
                    style={{
                      maskImage: `url("${redEcgPulseImage}")`,
                      WebkitMaskImage: `url("${redEcgPulseImage}")`,
                      maskSize: "contain",
                      WebkitMaskSize: "contain",
                      maskRepeat: "no-repeat",
                      WebkitMaskRepeat: "no-repeat",
                      maskPosition: "right center",
                      WebkitMaskPosition: "right center",
                    }}
                  />
                </div>
              </div>
            </h1>

            {/* Supporting Tagline: Smaller, lighter, light MEDEX green (#7AA05A) */}
            <p className="text-xs sm:text-sm font-normal text-[#7AA05A] tracking-normal mt-3 sm:mt-4 mb-0">
              Reliable Equipment. Better Care.
            </p>
          </div>

          {/* RIGHT COLUMN: MEDICAL PRODUCT IMAGE SHOWCASE (ON THE RIGHT) */}
          <div
            className="lg:col-span-7 w-full order-1 lg:order-2"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="flex flex-col sm:flex-row gap-0 sm:gap-6 md:gap-7 lg:gap-8 items-stretch">

              {/* THREE SECONDARY THUMBNAILS: HIDDEN ON MOBILE PHONES, VISIBLE ON SM AND UP */}
              <div className="relative z-10 hidden sm:flex sm:flex-col gap-2.5 sm:gap-3.5 md:gap-4 w-full sm:w-[88px] md:w-[96px] lg:w-[104px] shrink-0 justify-between items-center sm:items-stretch">
                {secondaryIndices.map((secIdx) => {
                  const secSlide = HERO_CATEGORY_SLIDES[secIdx];
                  return (
                    <button
                      key={secSlide.id}
                      type="button"
                      onClick={() => handleSelectThumbnail(secIdx)}
                      className="group relative flex-1 sm:flex-none w-full max-w-full aspect-[10/13.8] rounded-lg p-[7px] bg-white border-[1.5px] border-[#7AA05A] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#7AA05A]/40 transition-all duration-200 select-none shadow-xs hover:shadow-md"
                      aria-label={`View ${secSlide.categoryLabel}`}
                    >
                      <div className="w-full h-full rounded-[3.5px] overflow-hidden relative">
                        <img
                          src={secSlide.imageUrl}
                          alt={secSlide.categoryLabel}
                          className="w-full h-full object-cover group-hover:scale-105 active:scale-105 transition-transform duration-300 rounded-[3.5px]"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (target.src !== secSlide.fallbackUrl) {
                              target.src = secSlide.fallbackUrl;
                            }
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* LARGE MAIN IMAGE: FULL NATURAL 1199x1312 ASPECT RATIO ON MOBILE */}
              <div
                onClick={() => setIsMainCardZoomed((prev) => !prev)}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                className="relative z-0 flex-1 w-full rounded-none sm:rounded-2xl overflow-hidden group w-full aspect-[1199/1312] sm:aspect-auto sm:min-h-[420px] lg:min-h-[460px] xl:min-h-[480px] select-none cursor-pointer border-0 shadow-none"
                title="Click to toggle image zoom"
              >
                {/* Mobile: Horizontal slide track with transform; Desktop: static/absolute crossfade stack */}
                <div
                  className="hero-slider-track"
                  style={{ "--slide-x": `-${activeIndex * 100}%` } as React.CSSProperties}
                >
                  {HERO_CATEGORY_SLIDES.map((slide, idx) => {
                    const isActive = idx === activeIndex;
                    const isCurrentSlideZoomed = isActive && isMainCardZoomed;
                    return (
                      <div
                        key={slide.id}
                        className={`w-full min-w-full shrink-0 h-full relative sm:absolute sm:inset-0 sm:min-w-0 sm:shrink sm:transition-opacity sm:duration-500 sm:ease-in-out ${isActive
                          ? "sm:opacity-100 sm:z-10 sm:pointer-events-auto"
                          : "sm:opacity-0 sm:z-0 sm:pointer-events-none"
                          }`}
                        aria-hidden={!isActive}
                      >
                        <img
                          src={slide.imageUrl}
                          alt={slide.categoryLabel}
                          className={`w-full h-full object-contain sm:object-cover select-none rounded-none sm:rounded-2xl transition-transform duration-500 ease-out ${isCurrentSlideZoomed
                            ? "scale-105"
                            : "scale-100 sm:group-hover:scale-105"
                            }`}
                          loading={idx === 0 ? "eager" : "lazy"}
                          decoding="async"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (target.src !== slide.fallbackUrl) {
                              target.src = slide.fallbackUrl;
                            }
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Subtle dark vignette ONLY behind upper-left category text for contrast */}
                <div
                  className="absolute top-0 left-0 w-72 max-w-[70%] h-24 pointer-events-none z-10 rounded-none sm:rounded-tl-2xl"
                  style={{
                    background:
                      "radial-gradient(ellipse at top left, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0.15) 50%, rgba(0, 0, 0, 0) 80%)",
                  }}
                />

                {/* Category Name & Fading Light-Green Underline (Ends directly beneath SURGICAL) */}
                <div className="absolute top-4 left-4 sm:top-5 sm:left-6 z-20 pointer-events-none flex flex-col items-start">
                  <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)] flex flex-wrap items-baseline gap-x-1.5">
                    <span className="relative inline-block pb-1">
                      {activeSlide.categoryLabel.replace(/\s+EQUIPMENT$/, "")}
                      <span
                        className="absolute bottom-0 left-0 h-[2px] sm:h-[2.5px] w-full rounded-full pointer-events-none"
                        style={{
                          background:
                            "linear-gradient(to right, #7AA05A 0%, rgba(122, 160, 90, 0.7) 45%, rgba(122, 160, 90, 0.25) 80%, rgba(122, 160, 90, 0) 100%)",
                        }}
                      />
                    </span>
                    {activeSlide.categoryLabel.endsWith(" EQUIPMENT") && <span>EQUIPMENT</span>}
                  </span>
                </div>

                {/* Explore Products CTA: Minimalist white text & arrow with subtle float animation and drop shadow for legibility */}
                <div
                  className="absolute bottom-9 left-4 sm:bottom-9 sm:left-6 z-20 animate-hero-float"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    to={activeSlide.categoryPath}
                    className="group/cta inline-flex items-center gap-2 text-white font-bold text-xs sm:text-sm drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] hover:text-white/90 transition-transform duration-200 hover:scale-105 active:scale-95 select-none"
                    aria-label={`Explore ${activeSlide.categoryLabel}`}
                  >
                    <span className="font-bold tracking-tight text-white leading-none">Explore Products</span>
                    <ArrowRight size={14} className="text-white shrink-0 transition-transform duration-200 group-hover/cta:translate-x-1" strokeWidth={2.5} />
                  </Link>
                </div>

                {/* Carousel Navigation Dots: Clean slim active pill with thin white outline & 15-20% smaller inactive white dots */}
                <div
                  className="absolute bottom-3.5 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center gap-2 select-none"
                  aria-label="Slideshow position indicator"
                  role="tablist"
                  onClick={(e) => e.stopPropagation()}
                >
                  {HERO_CATEGORY_SLIDES.map((slide, idx) => {
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={slide.id}
                        type="button"
                        onClick={() => handleSelectThumbnail(idx)}
                        className={`transition-all duration-300 focus:outline-none cursor-pointer ${isActive
                          ? "w-6 h-2 sm:w-7 sm:h-2.5 rounded-full border border-white"
                          : "w-[5px] h-[5px] rounded-full bg-white/95 hover:bg-white shadow-xs"
                          }`}
                        style={
                          isActive
                            ? {
                              backgroundColor: "#7AA05A",
                              boxShadow: "0 0 3px rgba(255, 255, 255, 0.8)",
                            }
                            : undefined
                        }
                        aria-current={isActive ? "true" : undefined}
                        aria-label={`Slide ${idx + 1} of 6: ${slide.categoryLabel}`}
                      />
                    );
                  })}
                </div>

                {/* MOBILE ONLY: HERO CAROUSEL TAPERED GREEN CURVE (Thin in centre, smoothly wider at edges) */}
                <div className="absolute bottom-0 left-0 right-0 w-full h-[56px] pointer-events-none z-10 block sm:hidden overflow-hidden">
                  <svg
                    viewBox="0 0 1000 140"
                    preserveAspectRatio="none"
                    className="w-full h-full"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <linearGradient id="mobileGreenBandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#7AA05A" />
                        <stop offset="25%" stopColor="#558052" />
                        <stop offset="50%" stopColor="#2D5A4A" />
                        <stop offset="75%" stopColor="#558052" />
                        <stop offset="100%" stopColor="#7AA05A" />
                      </linearGradient>
                    </defs>

                    {/* 3. Solid pure white fill below the tapered green band transitioning into section background */}
                    <path
                      d="M 0,86 C 200,134 380,138 500,138 C 680,138 840,112 1000,56 L 1000,140 L 0,140 Z"
                      fill="#FFFFFF"
                    />

                    {/* 2. Continuous tapered green band: noticeably thinner around centre (8 units), smoothly widening to both edges (28 & 30 units) */}
                    <path
                      d="M 0,58 C 200,120 380,130 500,130 C 680,130 840,92 1000,26 L 1000,56 C 840,112 680,138 500,138 C 380,138 200,134 0,86 Z"
                      fill="url(#mobileGreenBandGrad)"
                    />

                    {/* 1. Clean white separator/border immediately above the green strip */}
                    <path
                      d="M 0,56 C 200,118 380,128 500,128 C 680,128 840,90 1000,24"
                      stroke="#FFFFFF"
                      strokeWidth="4.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

              </div>

            </div>
          </div>

        </div>

        {/* THREE FEATURE CARDS DIRECTLY BELOW THE HERO: HORIZONTAL ICON + TEXT LAYOUT WITH DIRECTIONAL ENTRANCE ANIMATIONS */}
        <div
          ref={cardsContainerRef}
          className="mt-12 sm:mt-16 lg:mt-20 mx-4 sm:mx-0 bg-[#2D5A4A] rounded-none overflow-hidden grid grid-cols-1 md:grid-cols-3 divide-y-2 md:divide-y-0 md:divide-x-2 divide-white"
        >
          {/* Card 1: Trusted Medical Equipment (Left to right entrance) */}
          <div
            className={`p-6 sm:p-7 lg:p-8 flex items-center gap-4 sm:gap-5 bg-[#2D5A4A] transition-all duration-500 ease-out motion-reduce:transform-none motion-reduce:transition-none motion-reduce:opacity-100 ${
              cardsVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8 sm:-translate-x-12"
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck size={26} className="text-[#F4B400]" style={{ color: "#F4B400" }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-white mb-1 leading-snug">
                Trusted Medical Equipment
              </h3>
              <p className="text-white/90 text-xs sm:text-[13px] leading-relaxed">
                Reliable medical equipment designed to support hospitals, clinics and healthcare professionals with confidence.
              </p>
            </div>
          </div>

          {/* Card 2: Advanced Medical Technology (Right to left entrance) */}
          <div
            className={`p-6 sm:p-7 lg:p-8 flex items-center gap-4 sm:gap-5 bg-[#2D5A4A] transition-all duration-500 ease-out motion-reduce:transform-none motion-reduce:transition-none motion-reduce:opacity-100 ${
              cardsVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8 sm:translate-x-12"
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs">
              <Cpu size={26} className="text-[#F4B400]" style={{ color: "#F4B400" }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-white mb-1 leading-snug">
                Advanced Medical Technology
              </h3>
              <p className="text-white/90 text-xs sm:text-[13px] leading-relaxed">
                Explore precision-engineered medical solutions built for modern healthcare environments and clinical requirements.
              </p>
            </div>
          </div>

          {/* Card 3: Healthcare Excellence (Left to right entrance) */}
          <div
            className={`p-6 sm:p-7 lg:p-8 flex items-center gap-4 sm:gap-5 bg-[#2D5A4A] transition-all duration-500 ease-out motion-reduce:transform-none motion-reduce:transition-none motion-reduce:opacity-100 ${
              cardsVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8 sm:-translate-x-12"
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs">
              <Award size={26} className="text-[#F4B400]" style={{ color: "#F4B400" }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-white mb-1 leading-snug">
                Healthcare Excellence
              </h3>
              <p className="text-white/90 text-xs sm:text-[13px] leading-relaxed">
                Supporting healthcare professionals with dependable equipment, professional service and quality-focused solutions.
              </p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
