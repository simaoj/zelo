import { redirect } from 'next/navigation';

/** Old link (/pressao) — kept working: blood pressure now lives under Saúde. */
export default function Page() {
  redirect('/saude/pressao');
}
