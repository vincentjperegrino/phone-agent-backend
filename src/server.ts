import { RawData, WebSocket } from "ws";
import { Request } from "express";
import express from "express";
import expressWs from "express-ws";
import { LLMDummyMock, RetellRequest } from "./llm/dummy";

export class Server {
  public app: expressWs.Application;

  constructor() {
    this.app = expressWs(express()).app;

    this.initializeRoutes();
  }

  listen(port: number): void {
    this.app.listen(port);
    console.log("Listening on " + port);
  }

  private initializeRoutes(): void {
    this.app.ws("/llm-websocket/:call_id", async (ws: WebSocket, req: Request) => {
        const callId = req.params.call_id;
        const llmClient = new LLMDummyMock();
    
        ws.on("error", (err: Error) => {
          console.error("Error received in LLM websocket client: ", err);
        });
    
        // Send Begin message
        llmClient.BeginMessage(ws);
    
        ws.on("message", async (data: RawData, isBinary: boolean) => {
          if (isBinary) {
            console.error("Got binary message instead of text in websocket.");
            ws.close(1002, "Cannot find corresponding Retell LLM.");
          }
          try {
            const request: RetellRequest = JSON.parse(data.toString());
            // LLM will think about a response
            llmClient.DraftResponse(request, ws);
          } catch (err) {
            console.error("Error in parsing LLM websocket message: ", err);
            ws.close(1002, "Cannot parse incoming message.");
          }
        });
    });
  }
}