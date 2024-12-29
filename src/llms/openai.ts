import OpenAI from "openai";
import { WebSocket } from "ws";
import {
  CustomLlmResponse,
  FunctionCall,
  ReminderRequiredRequest,
  ResponseRequiredRequest,
  Utterance,
} from "../types";

const servicesData = {
  services: {
    color: [2190, 17530],
    treatment: [2300, 5200],
    smoothing: [2800, 10500],
    styling: [600, 4000],
    addOn: [300, 950],
  },
  locations: [
    {
      branch: "Forbes Town BGC",
      address: "Rizal Drive, Forbes Town, Fort Bonifacio, Taguig",
    },
    {
      branch: "Estancia Capitol Commons",
      address:
        "3/F East Wing, Estancia at Capitol Commons, Meralco Avenue, Oranbo, Pasig",
    },
    {
      branch: "Molito Alabang",
      address:
        "Bldg. 8 Unit 24 Molito Lifestyle Center, Alabang Zapote Road Corner Madrigal Ave., Alabang Muntinlupa, 1700 Metro Manila",
    },
  ],
};

const beginSentence = `Hi there! I’m the Color Bar Salon’s AI assistant. How can I help you today?`;

const task = `
As a salon assistant, you handle inquiries about services, pricing, locations, and operating hours. 
The salon is open from **Monday to Sunday, 10 AM to 9 PM**.
When booking an appointment, you need to ask for the following details:
- The user's **name**.
- **Contact information** (such as phone number or email).
- The **desired service** (e.g., color treatment, styling, etc.).
- The **preferred date and time** for the appointment. 
You provide accurate details, simulate appointment bookings, and direct users to a stylist for advanced queries. 
Always be polite, concise, and friendly, prioritizing a positive customer experience.
`;

const conversationalStyle = `
- Respond conversationally and succinctly.
- Keep replies clear and under 20 words when possible.
- End responses with a helpful follow-up question or next step.
`;

const personality = `
- Be warm, professional, and enthusiastic about assisting customers.
- Use approachable language and avoid sounding robotic.
`;

const agentPrompt = `
Task:
${task}

Conversational Style:
${conversationalStyle}

Personality:
${personality}
`;

const objective = `
##Objective
You are a voice AI agent representing The Color Bar Salon. You engage in natural conversations to answer customer questions and assist with bookings or other inquiries.
`;

const styleGuardrails = `
## Style Guardrails
- [Be concise] Address one question at a time.
- [Avoid repetition] Use varied phrasing for repeated concepts.
- [Be conversational] Emulate a friendly salon receptionist’s tone.
- [Inject warmth] Convey enthusiasm and friendliness in responses.
- [Be proactive] Lead conversations by suggesting next steps or asking clarifying questions.
`;

const responseGuideline = `
## Response Guideline
- [Handle ASR errors] Assume and clarify potential transcription errors without explicitly mentioning them.
- [Stay in role] Keep responses focused on salon-related topics and redirect advanced queries to stylists.
- [Maintain smooth flow] Ensure responses fit seamlessly into the ongoing conversation.
`;

const systemPrompt = `
${objective}
${styleGuardrails}
${responseGuideline}
## Role
${agentPrompt}
`;

export class OpenAIClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  BeginMessage(ws: WebSocket) {
    const res: CustomLlmResponse = {
      response_type: "response",
      response_id: 0,
      content: beginSentence,
      content_complete: true,
      end_call: false,
    };
    ws.send(JSON.stringify(res));
  }

  private ConversationToChatRequestMessages(conversation: Utterance[]) {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (const turn of conversation) {
      result.push({
        role: turn.role === "agent" ? "assistant" : "user",
        content: turn.content,
      });
    }
    return result;
  }

  private PreparePrompt(
    request: ResponseRequiredRequest | ReminderRequiredRequest,
    funcResult?: FunctionCall
  ) {
    const transcript = this.ConversationToChatRequestMessages(
      request.transcript
    );
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        {
          role: "system",
          content: systemPrompt,
        },
      ];
    for (const message of transcript) {
      requestMessages.push(message);
    }

    if (funcResult) {
      requestMessages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: funcResult.id,
            type: "function",
            function: {
              name: funcResult.funcName,
              arguments: JSON.stringify(funcResult.arguments),
            },
          },
        ],
      });
      requestMessages.push({
        role: "tool",
        tool_call_id: funcResult.id,
        content: funcResult.result || "",
      });
    }

    if (request.interaction_type === "reminder_required") {
      requestMessages.push({
        role: "user",
        content: "(Prompt the user politely after a period of inactivity.)",
      });
    }
    return requestMessages;
  }

  async DraftResponse(
    request: ResponseRequiredRequest | ReminderRequiredRequest,
    ws: WebSocket,
    funcResult?: FunctionCall
  ) {
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      this.PreparePrompt(request, funcResult);

    let funcCall: FunctionCall | undefined;
    let funcArguments = "";
    const userMessage = request.transcript.find(
      (item) => item.role === "user"
    );
    const content = userMessage
              ? userMessage.content.toLowerCase()
              : "";

    try {
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "end_call",
            description: "End the call upon user request.",
            parameters: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "Final message before ending the call.",
                },
              },
              required: ["message"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "book_appointment",
            description: "Book an appointment for the salon.",
            parameters: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description:
                    "Message to the user about booking the appointment.",
                },
                date: {
                  type: "string",
                  description: "Appointment date in YYYY-MM-DD format.",
                },
              },
              required: ["message"],
            },
          },
        },
      ];

      const events = await this.client.chat.completions.create({
        model: process.env.OPENAI_LLM_MODEL as string,
        messages: requestMessages,
        stream: true,
        temperature: 0.1,
        max_tokens: 200,
        frequency_penalty: 1.0,
        presence_penalty: 1.0,
        tools: tools,
      });

      for await (const event of events) {
        if (event.choices.length >= 1) {
          const delta = event.choices[0].delta;
          if (!delta) continue;

          if (delta.tool_calls && delta.tool_calls.length >= 1) {
            const toolCall = delta.tool_calls[0];
            if (toolCall.id) {
              if (funcCall) {
                break;
              } else {
                funcCall = {
                  id: toolCall.id,
                  funcName: toolCall.function?.name || "",
                  arguments: {},
                };
              }
            } else {
              funcArguments += toolCall.function?.arguments || "";
            }
          } else if (delta.content) {
            if (
              content.includes("locations") ||
              content.includes("address") ||
              content.includes("located")
            ) {
              const locationsList = servicesData.locations
                .map(
                  (location) =>
                    `${location.branch} branch at ${location.address}`
                )
                .join("; ");

              const response = `We have branches at ${locationsList}.`;

              const res = {
                response_type: "response",
                response_id: request.response_id,
                content: response,
                content_complete: true,
                end_call: false,
              };

              ws.send(JSON.stringify(res));
            } else if (content.match(/(services|pricing|prices)/i)) {
              // Create a response with the price ranges for all service categories
              const allCategories = [
                {
                  name: "Color Services",
                  priceRange: `${servicesData.services.color[0]} to ${servicesData.services.color[1]} pesos`,
                },
                {
                  name: "Treatment Services",
                  priceRange: `${servicesData.services.treatment[0]} to ${servicesData.services.treatment[1]} pesos`,
                },
                {
                  name: "Smoothing Treatments",
                  priceRange: `${servicesData.services.smoothing[0]} to ${servicesData.services.smoothing[1]} pesos`,
                },
                {
                  name: "Styling Services",
                  priceRange: `${servicesData.services.styling[0]} to ${servicesData.services.styling[1]} pesos`,
                },
                {
                  name: "Add-On Services",
                  priceRange: `${servicesData.services.addOn[0]} to ${servicesData.services.addOn[1]} pesos`,
                },
              ];

              // Generate a response listing all service categories and their price ranges
              let responseText =
                "Here are the service categories and their price ranges:\n";
              allCategories.forEach((category) => {
                responseText += `${category.name}: ${category.priceRange}\n`;
              });

              const res = {
                response_type: "response",
                response_id: request.response_id,
                content: responseText,
                content_complete: true,
                end_call: false,
              };
              ws.send(JSON.stringify(res));
            } else if (
              content.match(
                /(color services|treatment services|smoothing treatments|styling services|add-on services)/i
              )
            ) {
              let category, lowPrice, highPrice;

              // Check the category and get the appropriate price range
              if (content.includes("color services")) {
                category = "Color Services";
                lowPrice = servicesData.services.color[0];
                highPrice = servicesData.services.color[1];
              } else if (content.includes("treatment services")) {
                category = "Treatment Services";
                lowPrice = servicesData.services.treatment[0];
                highPrice = servicesData.services.treatment[1];
              } else if (content.includes("smoothing treatments")) {
                category = "Smoothing Treatments";
                lowPrice = servicesData.services.smoothing[0];
                highPrice = servicesData.services.smoothing[1];
              } else if (content.includes("styling services")) {
                category = "Styling Services";
                lowPrice = servicesData.services.styling[0];
                highPrice = servicesData.services.styling[1];
              } else if (content.includes("add-on services")) {
                category = "Add-On Services";
                lowPrice = servicesData.services.addOn[0];
                highPrice = servicesData.services.addOn[1];
              }

              // Generic response with the price range for the category
              const response = `The price range for ${category} varies from ${lowPrice} to ${highPrice} pesos.`;
              const res = {
                response_type: "response",
                response_id: request.response_id,
                content: response,
                content_complete: true,
                end_call: false,
              };
              ws.send(JSON.stringify(res));
            } else {
              const res: CustomLlmResponse = {
                response_type: "response",
                response_id: request.response_id,
                content: delta.content,
                content_complete: false,
                end_call: false,
              };
              ws.send(JSON.stringify(res));
            }
          }
        }
      }
    } catch (err) {
      console.error("Error in GPT stream: ", err);
    } finally {
      if (funcCall != null) {
        if (funcCall.funcName === "end_call") {
          funcCall.arguments = JSON.parse(funcArguments);
          const res: CustomLlmResponse = {
            response_type: "response",
            response_id: request.response_id,
            content: funcCall.arguments.message,
            content_complete: true,
            end_call: true,
          };
          ws.send(JSON.stringify(res));
        }

        if (funcCall.funcName === "book_appointment") {
          funcCall.arguments = JSON.parse(funcArguments);
          const res: CustomLlmResponse = {
            response_type: "response",
            response_id: request.response_id,
            content: funcCall.arguments.message,
            content_complete: false,
            end_call: false,
          };
          ws.send(JSON.stringify(res));

          const functionInvocationResponse: CustomLlmResponse = {
            response_type: "tool_call_invocation",
            tool_call_id: funcCall.id,
            name: funcCall.funcName,
            arguments: JSON.stringify(funcCall.arguments)
          };
          ws.send(JSON.stringify(functionInvocationResponse));

          // Sleep 2s to mimic the actual appointment booking
          await new Promise((r) => setTimeout(r, 2000));
          funcCall.result = "Appointment booked successfully";

          const functionResult: CustomLlmResponse = {
            response_type: "tool_call_result",
            tool_call_id: funcCall.id,
            content: "Appointment booked successfully",
          };
          ws.send(JSON.stringify(functionResult));

          this.DraftResponse(request, ws, funcCall);
        }
      } else {
        const res: CustomLlmResponse = {
          response_type: "response",
          response_id: request.response_id,
          content: "",
          content_complete: true,
          end_call: false,
        };
        ws.send(JSON.stringify(res));
      }
    }
  }
}

function getTomorrowDate() {
  const today = new Date();
  today.setDate(today.getDate() + 1); // Move to the next day
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0'); // Add leading zero for months
  const dd = String(today.getDate()).padStart(2, '0'); // Add leading zero for days
  return `${yyyy}-${mm}-${dd}`;
}