# Instructions for Running Locally

## Steps to Run Locally

1. **Add Retell and your LLM API key** (Azure OpenAI / OpenAI / OpenRouter) to `.env.development`.

    - **Azure OpenAI** is pretty fast and stable. [Guide for setup](#)
    - **OpenAI** is the most widely used one, although the latency can vary.
    - **OpenRouter** allows you to choose between tons of Open Source AI Models.

2. **Install dependencies**

    Run the following command in your project directory:

    ```bash
    npm install
    ```

3. **Expose the server to the public network using ngrok**

    Open another terminal window and run:

    ```bash
    ngrok http 8080
    ```

    This will expose your local server to the public network and provide a forwarding URL. For example, the output might look like this:

    ```
    Forwarding                    https://dc14-2601-645-c57f-8670-9986-5662-2c9a-adbd.ngrok-free.app -> http://localhost:8080
    ```

4. **Start the server**

    Run the following command in the original terminal window:

    ```bash
    npm run dev
    ```

    You should see a forwarding address like `https://dc14-2601-645-c57f-8670-9986-5662-2c9a-adbd.ngrok-free.app`.

5. **Prepare the Custom LLM URL**

    - Take the hostname from the ngrok forwarding address. In this case, `dc14-2601-645-c57f-8670-9986-5662-2c9a-adbd.ngrok-free.app`.
    - Prepend the hostname with `wss://` and append `/llm-websocket` to the URL.

    The final URL for the custom LLM WebSocket connection should look like:

    ```text
    wss://dc14-2601-645-c57f-8670-9986-5662-2c9a-adbd.ngrok-free.app/llm-websocket
    ```

6. **Create a New Agent in the Dashboard**

    - Use the above WebSocket URL in the dashboard to create a new agent.
    - The agent you created should now connect to your localhost.
