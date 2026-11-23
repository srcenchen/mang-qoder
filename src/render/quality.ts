export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  name: QualityName;
  label: string;
  maxDpr: number;
  shadows: boolean;
  shadowMapSize: number;
  reflections: boolean;
  reflScale: number;
  ssao: boolean;
  aoTaps: number;
  bloom: boolean;
  rainCount: number;
  splashCount: number;
  fxaa: boolean;
}

export const QUALITY_PROFILES: Record<QualityName, QualityProfile> = {
  low: {
    name: 'low',
    label: '低',
    maxDpr: 1.0,
    shadows: false,
    shadowMapSize: 512,
    reflections: false,
    reflScale: 0.25,
    ssao: false,
    aoTaps: 6,
    bloom: true,
    rainCount: 450,
    splashCount: 120,
    fxaa: false,
  },
  medium: {
    name: 'medium',
    label: '中',
    maxDpr: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    reflections: true,
    reflScale: 0.38,
    ssao: false,
    aoTaps: 8,
    bloom: true,
    rainCount: 950,
    splashCount: 240,
    fxaa: true,
  },
  high: {
    name: 'high',
    label: '高',
    maxDpr: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    reflections: true,
    reflScale: 0.45,
    ssao: true,
    aoTaps: 8,
    bloom: true,
    rainCount: 1400,
    splashCount: 360,
    fxaa: true,
  },
  ultra: {
    name: 'ultra',
    label: '极高',
    maxDpr: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    reflections: true,
    reflScale: 0.55,
    ssao: true,
    aoTaps: 12,
    bloom: true,
    rainCount: 2000,
    splashCount: 520,
    fxaa: true,
  },
};

export function detectDefaultQuality(): QualityName {
  const isMobile =
    /Android|iPhone|iPad|iPod|MicroMessenger/i.test(navigator.userAgent) ||
    window.innerWidth < 768;
  return isMobile ? 'medium' : 'high';
}
