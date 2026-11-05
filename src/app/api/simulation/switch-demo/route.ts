import { NextRequest, NextResponse } from 'next/server';
import { isProductionEnvironment } from '@/lib/runtime/environment';
import { startSwitchDemo, advanceSwitchDemo, SWITCH_SCENARIO_STEPS } from '@/lib/simulation/switchScenario';
import { apiErrorMessage } from '@/lib/i18n/api';
import { getRequestLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';

export async function GET() {
  const locale = await getRequestLocale();
  if (isProductionEnvironment()) {
    return NextResponse.json({ error: 'DEMO_DISABLED', message: apiErrorMessage(locale, 'DEMO_DISABLED') }, { status: 404 });
  }
  return NextResponse.json({ session: startSwitchDemo(), totalSteps: SWITCH_SCENARIO_STEPS.length });
}

export async function POST(request: NextRequest) {
  const locale = await getRequestLocale();
  if (isProductionEnvironment()) {
    return NextResponse.json({ error: 'DEMO_DISABLED', message: apiErrorMessage(locale, 'DEMO_DISABLED') }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  try {
    if (!body.sessionId) {
      return NextResponse.json({ session: startSwitchDemo(), totalSteps: SWITCH_SCENARIO_STEPS.length }, { status: 201 });
    }

    const currentStep = Number.isInteger(body.stepIndex) ? body.stepIndex : 0;
    return NextResponse.json({
      ...advanceSwitchDemo(body.sessionId, currentStep),
      totalSteps: SWITCH_SCENARIO_STEPS.length,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'DEMO_ERROR';
    const message = code === 'STEP_OUT_OF_BOUNDS'
      ? apiErrorMessage(locale, 'STEP_OUT_OF_BOUNDS')
      : apiErrorMessage(locale, 'DEMO_FAILED');
    return NextResponse.json({ error: code, message }, { status: code === 'SESSION_NOT_FOUND' ? 404 : 422 });
  }
}
