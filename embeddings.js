const { chunkTokens, fetchTitlesAndContent } = require('./utils');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require("openai");
const { get_encoding } = require('@dqbd/tiktoken');

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
    // Step 1: scrape news articles and save to processed/articles.csv
    await fetchTitlesAndContent();

    // Step 2: tokenized the scraped article content
    const filePath = path.join(__dirname, 'processed', 'article.csv');
    const data = fs.readFileSync(filePath, 'utf8');
    const tokenizer = get_encoding("cl100k_base");
    const [headers, ...rows] = data.split('\n').map(row => row.split(','));

    const articles = [];
    for (const row of rows) {
        const title = row[0];
        const url = row[1];
        const content = row[2];
        if (!content) {
            continue;
        }
        const tokens = tokenizer.encode(content);

        articles.push({
            title,
            url,
            content,
            tokens,
        });
    }


    // Step 3: chunk token to max of 8191, as required by OpenAI API
    const chunkedArticles = [];
    const chunkedTokenSize = 1000;
    for (const article of articles) {
        const tokenLength = article.tokens.length;
        if (tokenLength > chunkedTokenSize) {
            const shortenedSentences = chunkTokens(article.content, chunkedTokenSize, tokenizer);
            for (const shortenedSentence of shortenedSentences) {
                chunkedArticles.push({
                    ...article,
                    content: shortenedSentence,
                    tokens: tokenizer.encode(shortenedSentence)
                });
            }
        } else {
            chunkedArticles.push(article);
        }
    }


    // Step 4: create embeddings from tokens using OpenAI API
    const contentArray = chunkedArticles.map(article => article.content);
    const contentEmbeddings = await openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: contentArray,
    });

    const embeddingsData = contentEmbeddings.data.data;
    const articleEmbeddings = [];
    for (let i = 0; i < chunkedArticles.length; i++) {
        const article = chunkedArticles[i];
        const embeddingStr = embeddingsData[i].embedding.join(delimiter);   // serailize embedding elements with delimiter '|'
        articleEmbeddings.push(`${article.title},${article.content},${embeddingStr}\n`);
    }
    const csvHeaders = 'Title,Content,Embedding\n';
    const csvContent = csvHeaders + articleEmbeddings.join('');
    fs.writeFileSync(csvFilePath, csvContent);

})();
