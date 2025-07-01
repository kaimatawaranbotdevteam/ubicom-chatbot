// Imports
const axios = require('axios');
const { SearchClient, SearchIndexClient, AzureKeyCredential, odata } = require('@azure/search-documents');
const { BlobServiceClient } = require('@azure/storage-blob');
const xlsx = require('xlsx');

require('dotenv').config();

const express = require('express');
const app = express();
app.use(express.json());

const cors = require('cors');
app.use(cors());

const path = require('path');


// Serve static files from React build (already copied to server/public)
app.use(express.static(path.join(__dirname, 'wwwroot')));

// // Sample API route
// app.get('/api/hello', (req, res) => {
//   res.json({ message: 'Hello from backend!' });
// });

// // Fallback route for React (SPA support)
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

// Azure Blob Storage Setup
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);

// Azure Cognitive Search Setup
const searchClient = new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT,
    process.env.AZURE_SEARCH_INDEX_NAME,
    new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY)
);

// ---------------
// Routes
// ---------------

// Import and Embed Data
app.post('/api/import', async (req, res) => {
    try {
        const rows = await fetchExcelFromBlob();

        const enrichedRows = [];
        for (const row of rows) {
            const text = Object.values(row).join(' '); // Combine all columns
            const embedding = await generateEmbedding(text);
            enrichedRows.push({
            ...row,
            embedding,
        });
        }

        await uploadDocuments(enrichedRows);

        res.json({ message: "Data imported and indexed successfully." });
    } catch (error) {
        console.error('Import error:', error.message);
        res.status(500).json({ error: 'Failed to import and index data.' });
    }
});

// Query with RAG
app.post('/api/query', async (req, res) => {
    // Updated code for conversational rag pipeline
    const { messages } = req.body;
    console.log(req.body);

    console.log(messages.length);
    const latestUserMessage = messages[messages.length - 1].content;

    try {
        // Rephrase the latest user question to be self-contained
        const rephrasedQuestion = latestUserMessage; //await rephraseQuestion(messages.slice(0, -1), latestUserMessage);
        console.log("rephasedQuestion: " + rephrasedQuestion);

        // Embed the rephrased question
        const queryEmbedding = await getQueryEmbedding(rephrasedQuestion);//embedQuery(latestUserMessage);
        //console.log("queryEmbedding: " +queryEmbedding);

        // Retrieve relevant documents using vector search
        const documents = await retrieveDocumentsByVector(queryEmbedding);
        //console.log("documents: " +documents);

        // Generate a response using Azure OpenAI
        const reply = await generateResponse(messages, documents, latestUserMessage);
        res.json({ reply });
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

// ---------------
// Helper Functions
// ---------------

// Helper function to rephrase the question
async function rephraseQuestion(conversationHistory, latestQuestion)
{
    const prompt = `
    Given the conversation history:
    ${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

    Rephrase the user's last question to be self-contained:
    User: ${latestQuestion}
    Rephrased Question:
    `;

    try {
        const response = await axios.post(
            `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21`,
                {
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 4096
                },
                {
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': AZURE_OPENAI_API_KEY,
                },
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("rephraseQuestion failed:", err.response?.data || err.message);
        throw err;
    }
}

// Generate embedding for the input query
async function getQueryEmbedding(text)
{
    if (!text || typeof text !== 'string') throw new Error('Invalid query text');
    try {
        const response = await axios.post(
            `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT}/embeddings?api-version=2023-05-15`,
                { input: text },
                {
                headers: {
                    'api-key': process.env.AZURE_OPENAI_API_KEY,
                    'Content-Type': 'application/json',
                }
            }
        );
        return response.data.data[0].embedding;
    } catch (err) {
        console.error("getQueryEmbedding failed:", err.response?.data || err.message);
        throw err;
    }
}

// Helper function to retrieve documents using vector search
async function retrieveDocumentsByVector(embedding)
{
    const url = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2023-07-01-preview`;
        const requestBody = {
            search:"",
            vector: {
            value: embedding,
            fields: "embedding",
            k: 30, // top 5 matches
        },
        top: 30
    };

    try {
            const response = await axios.post(url, requestBody, {
            headers: {
                'api-key': process.env.AZURE_SEARCH_API_KEY,
                'Content-Type': 'application/json',
            }
        });

        return response.data.value.map(doc => doc.content);
    } catch (err) {
        console.error("Search request failed:", err.response?.data || err.message);
        throw err;
    }
}

// Helper function to generate a response using Azure OpenAI
async function generateResponse(conversationHistory, documents, userQuestion)
{
    const systemPrompt = `
        **You are tasked to generate 10 functional test cases, prepare the corresponding test data, and
        organize it in a well-structured csv table based on the provided steps.**
        # Instructions
        1. **Generate Functional Test Cases**:
        Create functional test cases based on the input data that specifies the features. Each test
        case must include:
        - A unique **Test Case ID**
        - A **test case description** detailing the specific feature or behavior being tested.
        - The **expected outcome** that verifies the behavior is functioning as intended.
        2. **Prepare Test Data**:
        Identify and prepare test data necessary to execute each test case, ensuring that all data
        combinations are covered. Each test should have its corresponding data inputs defined. If
        different test cases share overlapping data attributes, note those overlaps and avoid redundancy
        when presenting them.
        Ensure the test data column contains all required input fields and values needed for execution
        in a clear, structured format (e.g., JSON-style representation or bullet points if Excel entry
        requires text format).
    `;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Context:\n" + documents.join("\n\n") },
        ...conversationHistory, // chat history
        { role: "user", content: userQuestion }
    ];
    console.log("final prompt: " + JSON.stringify(messages));
    
    const response = await axios.post(
        `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_COMPLETION_DEPLOYMENT}/chat/completions?api-version=2023-07-01-preview`,
        {
            messages,
            max_tokens: 4096
        },
        {
            headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.AZURE_OPENAI_API_KEY,
        },
        }
    );

    console.log(response.data.choices[0].message.content);
    return response.data.choices[0].message.content;
}

// Fetch and parse Excel from Blob Storage
async function fetchExcelFromBlob()
{
    const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_BLOB_CONTAINER_NAME);
    const blobClient = containerClient.getBlobClient(process.env.AZURE_BLOB_FILE_NAME);
    const downloadBlockBlobResponse = await blobClient.download();

    const buffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);
    const workbook = xlsx.read(buffer, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);

    console.log("fetch and parse done");

    const filename = (process.env.AZURE_BLOB_FILE_NAME).replace(/\.[^/.]+$/, "");

    const docs = jsonData.map((row, index) => {

    const rawUserFlow = row["User Flow"];
    const rawScreens = row["Screens"];
    const rawFeatures = row["Features"];
    console.log("User Flow: " +rawUserFlow);
    return {
        "@search.action": "upload",
        id: `${filename}-${index}`,
        filename: filename,
        userFlow: rawUserFlow,
        screens: rawScreens,
        features: rawFeatures,
        content: JSON.stringify(row),
        embedding: [],
    };
    });

    return docs;
}

// Generate Embeddings
async function generateEmbedding(text)
{
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Embedding input must be a non-empty string');
    }
    try{
        const response = await axios.post(
        `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT}/embeddings?api-version=2023-05-15`,
        {
            input: text
        },
        {
            headers: {
            'api-key': process.env.AZURE_OPENAI_API_KEY,
            'Content-Type': 'application/json'
            }
        }
        );
        console.log("embedding result: " + response.data.data[0]);
        return response.data.data[0].embedding;
        } catch (err) {
        console.error("Search request failed:", err.response?.data || err.message);
        throw err;
    }
}

async function uploadToAzureSearch(documents)
{
    try {
        console.log(documents);
    const indexUrl = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX_NAME}/docs/index?api-version=2023-07-01-Preview`;

    const payload = {
        value: documents.map((doc) => ({
        '@search.action': 'upload',
        ...doc,
        })),
    };

    const response = await axios.post(indexUrl, payload, {
        headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.AZURE_SEARCH_API_KEY,
        },
    });

    console.log('Indexed documents:', response.data);
    } catch (err) {
        console.error("Search request failed:", err.response?.data || err.message);
        throw err;
    }
}

async function createSearchIndex()
{
    const url = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX_NAME}?api-version=2023-07-01-Preview`;

    const indexSchema = {
        name: process.env.AZURE_SEARCH_INDEX_NAME,
        fields: [
        {
            name: "id",
            type: "Edm.String",
            key: true,
            searchable: false
        },
        {
            name: "filename",
            type: "Edm.String",
            searchable: true,  // Optional: set to true if you want to search by filename
            filterable: true,  // Recommended if you want to filter or facet by filename
            facetable: false
        },
        {
            name: "userFlow",
            type: "Edm.String",
            searchable: true,  // Optional: set to true if you want to search by filename
            filterable: true,  // Recommended if you want to filter or facet by filename
            facetable: false
        },
        {
            name: "screens",
            type: "Edm.String",
            searchable: true,  // Optional: set to true if you want to search by filename
            filterable: true,  // Recommended if you want to filter or facet by filename
            facetable: false
        },
        {
            name: "features",
            type: "Edm.String",
            searchable: true,  // Optional: set to true if you want to search by filename
            filterable: true,  // Recommended if you want to filter or facet by filename
            facetable: false
        },

        {
            name: "content",
            type: "Edm.String",
            searchable: true
        },
        {
            name: "embedding",
            type: "Collection(Edm.Single)",
            searchable: true,
            dimensions: 1536,
            vectorSearchConfiguration: "default"
        }
        ],
        vectorSearch: {
            algorithmConfigurations: [
            {
                name: "default",
                kind: "hnsw"
            }
            ],
        }
    };

    try {
        const response = await axios.put(url, indexSchema, {
        headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.AZURE_SEARCH_API_KEY
        }
    });

        console.log("Index created successfully:", response.data.name);
    } catch (error) {
        console.error("Error creating index:", error.response?.data || error.message);
    }
}

// to index csv and xls
//Function to create searchindex and import
async function main() {
    //initial only
    createSearchIndex();

    //for csv
    //await downloadCSVFromBlob();
    //const rows = await parseCSV('./temp.csv');
    //until here

    //for excel
    const rows = await fetchExcelFromBlob();
    //until here

    const filename = process.env.AZURE_BLOB_FILE_NAME.replace(/\.[^/.]+$/, "");
    const documents = [];

    for (const [i, row] of rows.entries()) {
        const content = Object.values(row).filter(Boolean).join(' ').trim();

        // Extract the JSON part using a regex match
        const match = content.match(/{.*}/);

        let userFlow;
        let screens;
        let features;
        if (match) {
            const jsonPart = match[0];
            const data = JSON.parse(jsonPart);

            userFlow = String(data["User Flow"]);
            screens = String(data["Screens"]);
            features = String(data["Features"]);
        } else {
            console.log("No JSON object found in line.");
        }

        if (!content) {
            console.warn(`Skipping empty row at index ${i}`);
            continue;
        }

        let vector;
        try {
            vector = await generateEmbedding(content);
        } catch (err) {
            console.error(`Embedding failed for row ${i}:`, err.message);
            continue;
        }

        documents.push({
            id: `${filename}-${i}`,
            filename: filename,
            userFlow: userFlow,
            screens: screens,
            features: features,
            content,
            embedding: vector
        });
    }

    console.log(documents);
    await uploadToAzureSearch(documents);

    // //for csv
    // //fs.unlinkSync('./temp.csv'); // Clean up
    // console.log('Data indexed with embeddings to Azure AI Search.');
}

// ---------------
// MAIN
// ---------------
// to index csv and xls
//main().catch(console.error);

// ---------------
// Start server
// ---------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
