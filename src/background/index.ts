import ExpiryMap from 'expiry-map'
import { v4 as uuidv4 } from 'uuid'
import Browser from 'webextension-polyfill'
import { Answer } from '../messaging.js'
import { sendMessageFeedback, setConversationProperty } from './chatgpt.js'
import { fetchSSE } from './fetch-sse.js'

const KEY_ACCESS_TOKEN = 'accessToken'

const cache = new ExpiryMap(10 * 1000)

async function getAccessToken(): Promise<string> {
  return 'sess-1FQn9GQBpNz86XDJ8fBuVufVMJfcO6xSqTB5a4qz'
}

async function generateAnswers(port: Browser.Runtime.Port, question: string) {
  const accessToken = await getAccessToken()

  let conversationId: string | undefined
  const deleteConversation = () => {
    if (conversationId) {
      setConversationProperty(accessToken, conversationId, { is_visible: false })
    }
  }

  const controller = new AbortController()
  port.onDisconnect.addListener(() => {
    controller.abort()
    deleteConversation()
  })

  await fetchSSE('https://chat.openai.com/backend-api/conversation', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: 'next',
      messages: [
        {
          id: uuidv4(),
          role: 'user',
          content: {
            content_type: 'text',
            parts: [question],
          },
        },
      ],
      model: 'text-davinci-002-render',
      parent_message_id: uuidv4(),
    }),
    onMessage(message: string) {
      console.debug('sse message', message)
      if (message === '[DONE]') {
        port.postMessage({ event: 'DONE' })
        deleteConversation()
        return
      }
      const data = JSON.parse(message)
      const text = data.message?.content?.parts?.[0]
      conversationId = data.conversation_id
      if (text) {
        port.postMessage({
          text,
          messageId: data.message.id,
          conversationId: data.conversation_id,
        } as Answer)
      }
    },
  })
}

Browser.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (msg) => {
    console.debug('received msg', msg)
    try {
      await generateAnswers(port, msg.question)
    } catch (err: any) {
      console.error(err)
      port.postMessage({ error: err.message })
      cache.delete(KEY_ACCESS_TOKEN)
    }
  })
})

Browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'FEEDBACK') {
    const token = await getAccessToken()
    await sendMessageFeedback(token, message.data)
  } else if (message.type === 'OPEN_OPTIONS_PAGE') {
    Browser.runtime.openOptionsPage()
  }
})

if (Browser.action) {
  Browser.action.onClicked.addListener(() => {
    Browser.runtime.openOptionsPage()
  })
} else {
  Browser.browserAction.onClicked.addListener(() => {
    Browser.runtime.openOptionsPage()
  })
}
