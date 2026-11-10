// L2 Email Workflow - Complete email processing workflow

import { ChatOllama } from '@langchain/ollama';
import {
  MemorySaver,
  START,
  END,
  StateGraph,
  Command,
  interrupt,
} from '@langchain/langgraph';
import z from 'zod';

const llm = new ChatOllama({
  model: 'qwen3.8:27b',
  baseUrl: 'http://localhost:11434',
});

// ===== Defining the state schema for the email workflow
export const EmailClassificationSchema = z.object({
  intent: z.enum(['question', 'bug', 'billing', 'feature', 'complex']),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  topic: z.string(),
  summary: z.string(),
});

// ===== Defining the state schema for the email agent
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

// ===== Defining the type for the email agent state
export type EmailAgentState = z.infer<typeof EmailStateDefinition>;

// ===== Setting the node functions for the email workflow
function readEmail(state: EmailAgentState) {
  console.log(`Processing email from ${state.senderEmail}`);
  return {};
}

async function classifyIntent(state: EmailAgentState) {
  console.log(`Classifying email intent and urgency...`);
  const structuredLlm = llm.withStructuredOutput(EmailClassificationSchema);
  const classificationPrompt = `
Analyze the customer email and classify its intent, urgency, topic, and provide a brief summary:
Email: ${state.emailContent}
From: ${state.senderEmail}

Provide classification, including intent, urgency, topic, and a brief summary in the specified structured format.
`;

  try {
    const classification = await structuredLlm.invoke(classificationPrompt);
    console.log('Classification', classification);
    return { classification };
  } catch (error) {
    console.error('Error classifying intent:', error);
    return {
      classification: {
        intent: 'question',
        urgency: 'medium',
        topic: 'general inquiry',
        summary: 'Unable to classify email due to error.',
      },
    };
  }
}

function bugTracking(state: EmailAgentState) {
  console.log('Creating bug tracking ticket...');

  const ticketId = `BUG-${Date.now()}`;
  console.log(`Ticket created with ID: ${ticketId}`);
  return { ticketId };
}

function searchDocumentation(state: EmailAgentState) {
  try {
    const searchResults = [
      `Documentation for ${state.classification?.intent}: Basic information about ${state.classification?.topic}`,
      `FAQ for ${state.classification?.intent}: Common questions and answers`,
      `Knowledge base article: How to handle ${state.classification?.intent} requests`,
    ];
    console.log('Found search results:', searchResults.length, 'items');
    return { searchResults };
  } catch (error) {
    console.error('Search error:', error);
    return {
      searchResults: [
        `Search temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

async function writeResponse(state: EmailAgentState) {
  const classification = state.classification ?? {
    intent: 'question',
    topic: 'general inquiry',
    urgency: 'medium',
  };

  const contextSections: string[] = [];
  if (state.searchResults && state.searchResults.length > 0) {
    const formattedDocs = state.searchResults
      .map((doc) => `- ${doc}`)
      .join('\n');
    contextSections.push(`Relevant documentation:\n${formattedDocs}`);
  }

  if (state.customerHistory && Object.keys(state.customerHistory).length > 0) {
    contextSections.push(
      `Customer tier: ${state.customerHistory.tier ?? 'standard'}`
    );
  }

  const draftPrompt = `
Draft a response to this customer email:
${state.emailContent}
Email intent: ${classification.intent}
Urgency level: ${classification.urgency}

${contextSections.join('\n\n')}

Guidelines:
- Be concise and professional.
- Address the customer's specific concerns based on the intent and urgency.
- Be brief and to the point, avoiding unnecessary details.
- Use the provided context to inform your response, but do not fabricate information.
  `;

  try {
    const response = await llm.invoke(draftPrompt);

    const classificationsToReview = ['high', 'critical'];
    const needReview =
      classificationsToReview.includes(classification.urgency) ||
      classification.intent === 'complex';

    const goto = needReview ? 'human_review' : 'send_reply'; // Determine next node based on urgency and intent

    return new Command({
      update: { draftResponse: response.content },
      goto,
    });
  } catch (error) {
    console.error('Error writing response:', error);
    return new Command({
      update: {
        draftResponse: 'Error generating response, please try again',
      },
      goto: 'human_review', // Fallback to human review on error
    });
  }
}

function humanReview(state: EmailAgentState) {
  const classification = state.classification ?? {
    intent: 'question',
    urgency: 'medium',
  };

  const humanDecision = interrupt({
    ...state,
    action:
      'Please review this draft response and approve or modify it before sending.',
  });

  if (humanDecision.approved) {
    const editedResponse = humanDecision.editedResponse ?? state.draftResponse;
    return new Command({
      update: { draftResponse: editedResponse },
      goto: 'send_reply',
    });
  }

  return new Command({
    update: {},
    goto: END, // If not approved, end the workflow
  });
}

function sendReply(state: EmailAgentState) {
  const preview = state.draftResponse?.substring(0, 60) + '...';
  console.log(`Sending reply to ${state.senderEmail}: ${preview}`);
  return { sent: true };
}

const memory = new MemorySaver();

// ===== Constructing the state graph for the email workflow
export const graph = new StateGraph(EmailStateDefinition)
  .addNode('read_email', readEmail)
  .addNode('classify_intent', classifyIntent)
  .addNode('bug_tracking', bugTracking)
  .addNode('search_documentation', searchDocumentation)
  .addNode('write_response', writeResponse, {
    ends: ['human_review', 'send_reply'],
  })
  .addNode('human_review', humanReview, {
    ends: ['send_reply', END],
  })
  .addNode('send_reply', sendReply)
  .addEdge(START, 'read_email')
  .addEdge('read_email', 'classify_intent')
  .addEdge('classify_intent', 'bug_tracking')
  .addEdge('classify_intent', 'search_documentation')
  .addEdge('bug_tracking', 'write_response')
  .addEdge('search_documentation', 'write_response')
  .addEdge('send_reply', END)
  .compile({ checkpointer: memory });
