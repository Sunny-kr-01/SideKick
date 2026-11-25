let activeTab;
let pageContext;
const askConversation = [];
const globalStatus = document.getElementById('globalStatus');

function showStatus(message, isError = false, target = globalStatus) {
    target.textContent = message;
    target.classList.toggle('error', isError);
}

function sendTabMessage(message) {
    return new Promise((resolve, reject) => {
        if (!activeTab?.id) {
            reject(new Error('No active browser tab is available.'));
            return;
        }

        chrome.tabs.sendMessage(activeTab.id, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(
                    'Sidekick cannot read this page. Try a regular webpage and refresh it.'
                ));
                return;
            }

            if (!response || response.error) {
                reject(new Error(response?.error || 'Could not read the current webpage.'));
                return;
            }

            resolve(response);
        });
    });
}

function findRelevantSections(question, history) {
    const stopWords = new Set([
        'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been',
        'before', 'between', 'but', 'can', 'could', 'did', 'does', 'during',
        'each', 'explain', 'find', 'for', 'from', 'have', 'here', 'how',
        'into', 'just', 'more', 'most', 'not', 'only', 'other', 'page',
        'please', 'show', 'some', 'such', 'than', 'that', 'the', 'their',
        'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
        'tell', 'under', 'use', 'using', 'very', 'was', 'were', 'what',
        'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with',
        'would', 'your'
    ]);
    const priorQuestions = history
        .filter((entry) => entry.role === 'user')
        .slice(-2)
        .map((entry) => entry.text);
    const words = [...new Set(
        (
            [question, ...priorQuestions]
                .join(' ')
                .toLowerCase()
                .match(/[a-z0-9]+/g) || []
        ).filter((word) => word.length > 2 && !stopWords.has(word))
    )];

    return (pageContext.sections || [])
        .map((section) => {
            const searchableText =
                `${section.heading} ${section.content}`.toLowerCase();
            const score = words.reduce(
                (total, word) => total + Number(searchableText.includes(word)),
                0
            );
            return { section, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map((entry) => entry.section);
}

function buildPagePrompt(question, history = []) {
    const relevantSections = findRelevantSections(question, history);
    const sectionContext = relevantSections.length
        ? relevantSections.map((section) =>
            `Heading: ${section.heading}\n${section.content}`
        ).join('\n\n')
        : 'No relevant page sections were found for this request.';
    const selectionContext = pageContext.selection?.url === pageContext.url &&
        pageContext.selection.text
        ? `\n\nRecently captured text:\n${pageContext.selection.text}`
        : '';
    const previousConversation = history.length
        ? `\n\nEarlier conversation:\n${history.map((entry) =>
            `${entry.role === 'user' ? 'User' : 'Sidekick'}: ${entry.text}`
        ).join('\n\n')}`
        : '';

    return `You are Sidekick, a helpful AI browser assistant.

Current webpage:
${pageContext.title || 'Untitled page'}
URL: ${pageContext.url || 'Unknown'}

Relevant page sections:
${sectionContext}${selectionContext}${previousConversation}

User request:
${question}

Instructions:
- Decide whether the user is asking for page-specific information or a general explanation.
- For page-specific requests, rely on supplied relevant sections and captured text. If they do not contain the answer, say that clearly instead of guessing.
- For page-specific answers, name relevant headings and include short supporting excerpts when useful.
- For general questions, answer normally using your knowledge; use the page only when it adds relevant context and distinguish page facts from general knowledge.
- Maintain context for follow-up questions.
- When a specific page section is useful to visit, output a separate line in exactly this format: SECTION: <exact heading>. Do not add punctuation after the heading or put markers inside code blocks. Use only a heading supplied above, and output no more than 3 markers.
- Do not output SECTION markers for general answers or headings that were not supplied.
- Start with a useful answer, not a greeting or self-introduction.
- Use concise, readable Markdown.`;
}

function askGemini(prompt) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'ASK_GEMINI', prompt },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (response?.error) {
                    reject(new Error(response.error.message || 'Gemini request failed.'));
                    return;
                }

                const text = response?.candidates?.[0]?.content?.parts
                    ?.map((part) => part.text || '')
                    .join('\n')
                    .trim();

                if (!text) {
                    reject(new Error('Gemini returned an empty response.'));
                    return;
                }

                resolve(text);
            }
        );
    });
}

function renderAssistantResponse(answer) {
    const result = document.getElementById('askResult');
    const message = document.createElement('div');
    message.className = 'chat-message assistant';

    let textLines = [];
    const appendText = () => {
        if (!textLines.length) return;
        const text = document.createElement('div');
        text.textContent = textLines.join('\n');
        message.appendChild(text);
        textLines = [];
    };

    const lines = answer.split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(
            /^\s*(?:[-*]\s*)?(?:\*\*)?SECTION\s*:\s*(.+?)(?:\*\*)?\s*$/i
        );
        if (!match) {
            textLines.push(line);
            continue;
        }

        const heading = match[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
        const normalize = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();
        const section = (pageContext.sections || []).find(
            (item) => normalize(item.heading) === normalize(heading)
        );
        if (!section) {
            textLines.push(line);
            continue;
        }

        appendText();
        const jumpButton = document.createElement('button');
        jumpButton.type = 'button';
        jumpButton.className = 'jump-button';
        jumpButton.textContent = `Go to ${section.heading}`;
        jumpButton.addEventListener('click', async () => {
            jumpButton.disabled = true;
            try {
                await sendTabMessage({
                    type: 'NAVIGATE_TO_SECTION',
                    heading: section.heading
                });
            } catch (error) {
                showStatus(error.message, true);
            } finally {
                jumpButton.disabled = false;
            }
        });
        message.appendChild(jumpButton);
    }

    appendText();
    result.appendChild(message);
    result.scrollTop = result.scrollHeight;
}

document.getElementById('askForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitChatQuestion();
});

async function submitChatQuestion() {
    const input = document.getElementById('askInput');
    const result = document.getElementById('askResult');
    const button = document.getElementById('askButton');
    const question = input.value.trim();

    if (!question) {
        showStatus('Enter a question first.', true);
        input.focus();
        return;
    }

    const userMessage = document.createElement('div');
    userMessage.className = 'chat-message user';
    userMessage.textContent = question;
    result.appendChild(userMessage);
    input.value = '';
    button.disabled = true;
    button.textContent = 'Thinking...';
    showStatus('');

    try {
        pageContext = await sendTabMessage({ type: 'GET_PAGE_CONTEXT' });
        if (!pageContext.text && !pageContext.selection?.text) {
            throw new Error('Page content is unavailable. Refresh the webpage and try again.');
        }

        const answer = await askGemini(buildPagePrompt(question, askConversation));

        askConversation.push(
            { role: 'user', text: question },
            { role: 'assistant', text: answer }
        );
        if (askConversation.length > 10) {
            askConversation.splice(0, askConversation.length - 10);
        }

        renderAssistantResponse(answer);
    } catch (error) {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'chat-message assistant';
        errorMessage.textContent = error.message;
        result.appendChild(errorMessage);
        result.scrollTop = result.scrollHeight;
    } finally {
        button.disabled = false;
        button.textContent = 'Ask AI';
        input.focus();
    }
}

async function initializeSidePanel() {
    try {
        const tabs = await new Promise((resolve, reject) => {
            chrome.tabs.query(
                { active: true, currentWindow: true },
                (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    resolve(result);
                }
            );
        });

        activeTab = tabs[0];
    } catch (error) {
        showStatus(`Could not initialize Sidekick: ${error.message}`, true);
    }
}

initializeSidePanel();
