import { NextRequest, NextResponse } from 'next/server';
import { startSwitchDemo, advanceSwitchDemo, SWITCH_SCENARIO_STEPS } from '@/lib/simulation/switchScenario';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ session: startSwitchDemo(), totalSteps: SWITCH_SCENARIO_STEPS.length });
}

export async function POST(request: NextRequest) {
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
    const message = code === 'STEP_OUT_OF_BOUNDS' ? 'デモのステップが範囲外です。' : 'デモセッションを処理できませんでした。';
    return NextResponse.json({ error: code, message }, { status: code === 'SESSION_NOT_FOUND' ? 404 : 422 });
  }
}

