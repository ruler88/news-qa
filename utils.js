const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const newsUrl = 'https://www.npr.org/sections/news/';

async function fetchTitlesAndContent() {
    const browser = await puppeteer.launch({
        headless: false,
        args: ["--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Navigate to the news page
    await page.goto(newsUrl);

    // Wait for the page to load
    await page.waitForSelector('h2.title');

    // Extract the article titles and URLs
    const articles = await page.evaluate(() => {
        const articleNodes = document.querySelectorAll('h2.title a');
        const articleArray = Array.from(articleNodes);
        return articleArray.map(article => ({
            title: article.textContent.trim(),
            url: article.href
        }));
    });

    // Loop through the articles and scrape their content
    const csvData = [];
    for (const article of articles) {
        await page.goto(article.url);
        await page.waitForSelector('div.storytext');

        const articleContent = await page.evaluate(() => {
            const contentNode = document.querySelector('div.storytext');
            return contentNode.textContent.trim();
        });

        const prunedContent = pruneString(articleContent);
        const prunedTitle = pruneString(article.title);
        csvData.push(`${prunedTitle},${article.url},${prunedContent}\n`);
    }

    await browser.close();

    // Create the 'processed' directory if it doesn't exist
    const directoryPath = path.join(__dirname, 'processed');
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath);
    }

    // Write the data to a CSV file using the fs package
    const csvFilePath = path.join(directoryPath, 'article.csv');
    const csvHeaders = 'Title,URL,Content\n';
    const csvContent = csvHeaders + csvData.join('');
    fs.writeFileSync(csvFilePath, csvContent);
}

function pruneString(str) {
    return str.replace(/[\t\n]/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function chunkTokens(text, maxTokens, tokenizer) {
    // Split the text into sentences
    const sentences = text.split('. ');

    const chunks = [];
    let tokensSoFar = 0;
    let chunk = [];

    // Loop through the sentences
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const tokenLength = tokenizer.encode(" " + sentence).length;

        // If the number of tokens so far plus the number of tokens in the current sentence is greater
        // than the max number of tokens, then add the chunk to the list of chunks and reset
        // the chunk and tokens so far
        if (tokensSoFar + tokenLength > maxTokens) {
            chunks.push(chunk.join('. ') + '.');
            chunk = [];
            tokensSoFar = 0;
        }

        // If the number of tokens in the current sentence is greater than the max number of
        // tokens, go to the next sentence and skip the sentence
        if (tokenLength > maxTokens) {
            continue;
        }

        // Otherwise, add the sentence to the chunk and add the number of tokens to the total
        chunk.push(sentence);
        tokensSoFar += tokenLength + 1;
    }

    // Add the last chunk
    if (chunk.length > 0) {
        chunks.push(chunk.join('. ') + '.');
    }

    return chunks;
}

module.exports = {
    chunkTokens,
    fetchTitlesAndContent,
};
