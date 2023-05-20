const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require("openai");
const { get_encoding } = require('@dqbd/tiktoken');
const similarity = require('compute-cosine-similarity');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

// Set up OpenAI configuration
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const delimiter = '|';
const directoryPath = path.join(__dirname, 'processed');
if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath);
}
const csvFilePath = path.join(directoryPath, 'embeddings.csv');

(async () => {
    const query = await new Promise(resolve => {
        readline.question("Please enter your question about NPR news today \n", resolve)
    });

    const queryResponse = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: query,
    });
    const queryEmbeddings = queryResponse.data.data[0].embedding;


    // Step 5: read embedding from csv and use it to calculate cosine distance
    const embeddingCsv = fs.readFileSync(csvFilePath, 'utf8');
    const embeddingRows = embeddingCsv.trim().split('\n').slice(1); // remove header row
    const embeddings = embeddingRows.map(row => {
        const [title, content, embedding] = row.split(',');
        return {
            title,
            content,
            embedding: embedding.split(delimiter).map(Number)   // deserialize embedding and convert to number
        };
    });

    const tokenizer = get_encoding("cl100k_base");
    const embeddingsWithCosineDistanceSorted = embeddings.map(row => {
        return {
            ...row,
            tokensCount: tokenizer.encode(row.content).length,
            distance: 1 - similarity(row.embedding, queryEmbeddings),
            // cosine distance is 1-cos_similarity
        }
    }).sort((a, b) => a.distance - b.distance); // sort by distance in ascending order

    // Step 6: Combine the rows with closest cosine distance up to max tokens length
    const maxTokensLength = 2500;
    let currTokensLength = 0;
    let articleConext = "";

    for (let i = 0; i < embeddingsWithCosineDistanceSorted.length && currTokensLength < maxTokensLength; i++) {
        const cosineDistanceRow = embeddingsWithCosineDistanceSorted[i];
        currTokensLength += cosineDistanceRow.tokensCount;
        if (currTokensLength < maxTokensLength) {
            articleConext += `\n${cosineDistanceRow.content}`;
        }
    }

    // Step 7: Use the article context to call text completion API
    const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: `Answer the question based on the context below. The context came from news articles. Answer should details around names, locations, timelines. And if the question can't be answered based on the context, say "I don't know"\n\nContext: ${articleConext}\n\n---\n\nQuestion: ${query}\nAnswer:`,
        max_tokens: 150,
        temperature: 0,
        presence_penalty: 0,
        frequency_penalty: 0,
        best_of: 1,
    });
    console.log(response.data.choices[0].text);



})();
