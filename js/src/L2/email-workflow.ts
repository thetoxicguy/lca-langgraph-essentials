// L2 Email Workflow - Complete email processing workflow

import { ChatOllama } from '@langchain/ollama';
import z from 'zod';

const llm = new ChatOllama({
  model: 'qwen3.8:27b',
  baseUrl: 'http://localhost:11434',
});

export const EmailClassificationSchema = z.object({
  intent: z.enum(['question', 'bug', 'billing', 'feature', 'complex']),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  topic: z.string(),
  summary: z.string(),
});

export const EmailStateDefinition = z.object({
  emailContent: z.string(),
  senderEmail: z.string(),
  emailId: z.string(),
  classification: EmailClassificationSchema.optional(),
  ticketId: z.string().optional(),
  searchResults: z.array(z.string()).optional(),
  customerHistory: z.record(z.string(), z.any()).optional(),
  draftResponse: z.string().optional(),
});

export type EmailAgentState = z.infer<typeof EmailStateDefinition>;
