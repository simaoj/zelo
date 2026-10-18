'use client';
import type { ActivityGoal } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { IntGoalDialog } from '@/shared/ui/IntGoalDialog';
import { STEPS_GOAL_MAX } from './activityLogic';

export function StepsGoalDialog({ goal, onClose }: { goal: ActivityGoal | null; onClose: () => void }) {
  const { data } = useZelo();
  return (
    <IntGoalDialog
      title={goal ? 'Ajustar meta pessoal de passos' : 'Definir meta pessoal de passos'}
      label="Meta diária"
      unit="passos"
      current={goal?.dailyStepsTarget ?? null}
      max={STEPS_GOAL_MAX}
      onSave={(v, operationId) => data.putActivityGoal({ operationId, dailyStepsTarget: v })}
      onRemove={() => data.deleteActivityGoal()}
      onClose={onClose}
    />
  );
}
