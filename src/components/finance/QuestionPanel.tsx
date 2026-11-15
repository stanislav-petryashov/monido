import type { ReactNode } from 'react'
import { Card } from '../ui/Card'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import '../../styles/finance.css'

/** One question with an immediately readable answer. Private content is unmounted, including accessible charts. */
export function QuestionPanel({ question, answer, children, id }: { question?: string; answer?: ReactNode; children?: ReactNode; id?: string }) {
  return <section id={id} className="financial-question">
    <Card>
      {question && <h2 className="financial-question__heading">{question}</h2>}
      <QuestionAnswer answer={answer}>{children}</QuestionAnswer>
    </Card>
  </section>
}

/** The answer alone, for a Disclosure row: the row is its frame and already says the question. */
export function QuestionAnswer({ answer, children, id }: { answer?: ReactNode; children?: ReactNode; id?: string }) {
  const { hidden } = usePrivacy()
  const body = hidden ? <p>{PRIVACY_MASK}</p> : <>
    {answer && <p className="financial-question__answer">{answer}</p>}
    {children}
  </>
  return id ? <section id={id} className="financial-answer">{body}</section> : body
}
