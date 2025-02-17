document.addEventListener('DOMContentLoaded', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        var currentTab = tabs[0];
        var actionButton = document.getElementById('actionButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');
        var filenameInput = document.getElementById('filenameInput');
        const API_KEY = 'YOUR_API_KEY';

        if (currentTab && currentTab.url.includes("://www.google.com/maps/search")) {
            document.getElementById('message').textContent = "Let's scrape Google Maps!";
            actionButton.disabled = false;
            actionButton.classList.add('enabled');
        } else {
            var messageElement = document.getElementById('message');
            messageElement.innerHTML = '';
            var linkElement = document.createElement('a');
            linkElement.href = 'https://www.google.com/maps/search/';
            linkElement.textContent = "Go to Google Maps Search.";
            linkElement.target = '_blank'; 
            messageElement.appendChild(linkElement);

            actionButton.style.display = 'none'; 
            downloadCsvButton.style.display = 'none';
            filenameInput.style.display = 'none'; 
        }

        // Enhanced URL cleaning function
        function cleanUrl(url) {
            if (!url) return '';
            
            // Remove trailing slashes and clean the URL
            url = url.trim().replace(/\/+$/, '');
            
            // Handle common redirects
            if (url.startsWith('http://')) {
                url = 'https://' + url.slice(7);
            }
            
            try {
                const urlObj = new URL(url);
                
                // Try adding www if it's not present
                if (!urlObj.hostname.startsWith('www.')) {
                    const withWww = new URL(url);
                    withWww.hostname = 'www.' + urlObj.hostname;
                    return withWww.toString();
                }
                
                return urlObj.toString();
            } catch (e) {
                return url;
            }
        }

        // Enhanced PageSpeed API fetch with fallback attempts
        async function fetchPageSpeedWithRetry(url, apiKey, maxRetries = 3, delay = 2000) {
            let lastError;
            const urlsToTry = [];
            
            try {
                const urlObj = new URL(url);
                
                // Create variations of the URL to try
                urlsToTry.push(url); // Original URL
                
                // Try with/without www
                if (urlObj.hostname.startsWith('www.')) {
                    urlsToTry.push(url.replace('www.', ''));
                } else {
                    urlsToTry.push(url.replace('//', '//www.'));
                }
                
                // Try with/without trailing slash
                urlsToTry.push(url + '/');
            } catch (e) {
                urlsToTry.push(url);
            }
            
            for (const urlVariation of urlsToTry) {
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        const cleanedUrl = cleanUrl(urlVariation);
                        if (!cleanedUrl) continue;

                        console.log(`Trying URL: ${cleanedUrl} (Attempt ${attempt + 1})`);
                        
                        const response = await fetch(
                            `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(cleanedUrl)}&key=${apiKey}&strategy=mobile`,
                            {
                                headers: {
                                    'Accept': 'application/json'
                                }
                            }
                        );

                        if (!response.ok) {
                            const errorData = await response.json();
                            console.log(`API Error for ${cleanedUrl}:`, errorData);
                            
                            if (response.status === 429) {
                                await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
                                continue;
                            }
                            
                            throw new Error(`API returned ${response.status}`);
                        }

                        const data = await response.json();
                        if (data.lighthouseResult) {
                            return data;
                        }
                        
                    } catch (error) {
                        console.log(`Attempt ${attempt + 1} failed for ${urlVariation}:`, error);
                        lastError = error;
                        
                        if (attempt < maxRetries - 1) {
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                }
            }
            
            throw lastError || new Error('All URL variations failed');
        }

        actionButton.addEventListener('click', function() {
            chrome.scripting.executeScript({
                target: {tabId: currentTab.id},
                func: scrapeData
            }, function(results) {
                while (resultsTable.firstChild) {
                    resultsTable.removeChild(resultsTable.firstChild);
                }

                const headers = ['Title', 'Rating', 'Reviews', 'Phone', 'Industry', 'Address', 'Website', 'Google Maps Link', 'Performance Score', 'Largest Painful Content', 'Speed Index'];
                const headerRow = document.createElement('tr');
                headers.forEach(headerText => {
                    const header = document.createElement('th');
                    header.textContent = headerText;
                    headerRow.appendChild(header);
                });
                resultsTable.appendChild(headerRow);

                if (!results || !results[0] || !results[0].result) return;

                results[0].result.forEach(function(item) {
                    var row = document.createElement('tr');
                    
                    // Add basic data
                    ['title', 'rating', 'reviewCount', 'phone', 'industry', 'address', 'companyUrl', 'href'].forEach(function(key) {
                        var cell = document.createElement('td');
                        if (key === 'reviewCount' && item[key]) {
                            item[key] = item[key].replace(/\(|\)/g, '');
                        }
                        cell.textContent = item[key] || '';
                        row.appendChild(cell);
                    });

                    // Add placeholder cells for PageSpeed scores
                    for (let i = 0; i < 3; i++) {
                        var cell = document.createElement('td');
                        cell.textContent = '-';
                        row.appendChild(cell);
                    }

                    resultsTable.appendChild(row);

                    // If there's a website URL, fetch PageSpeed data
                    if (item.companyUrl) {
                        fetchPageSpeedWithRetry(item.companyUrl, API_KEY)
                            .then(data => {
                                if (data.lighthouseResult && data.lighthouseResult.audits) {
                                    const audits = data.lighthouseResult.audits;
                                    const performanceScore = data.lighthouseResult.categories.performance?.score 
                                        ? Math.round(data.lighthouseResult.categories.performance.score * 100) 
                                        : '-';
                                    const lcp = audits['largest-contentful-paint']?.numericValue 
                                        ? Math.round(audits['largest-contentful-paint'].numericValue) 
                                        : '-';
                                    const speedIndex = audits['speed-index']?.numericValue 
                                        ? Math.round(audits['speed-index'].numericValue) 
                                        : '-';

                                    // Update the score cells
                                    const cells = row.cells;
                                    cells[cells.length - 3].textContent = performanceScore;
                                    cells[cells.length - 2].textContent = lcp;
                                    cells[cells.length - 1].textContent = speedIndex;
                                }
                            })
                            .catch(error => {
                                console.error('PageSpeed API error for ' + item.companyUrl + ':', error);
                                // Update cells to show error
                                const cells = row.cells;
                                cells[cells.length - 3].textContent = 'Error';
                                cells[cells.length - 2].textContent = 'Error';
                                cells[cells.length - 1].textContent = 'Error';
                            });
                    }
                });

                if (results && results[0] && results[0].result && results[0].result.length > 0) {
                    downloadCsvButton.disabled = false;
                }
            });
        });

        downloadCsvButton.addEventListener('click', function() {
            var csv = tableToCsv(resultsTable);
            var filename = filenameInput.value.trim();
            if (!filename) {
                filename = 'google-maps-data.csv';
            } else {
                filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
            }
            downloadCsv(csv, filename);
        });
    });
});

function scrapeData() {
    var links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
    return links.map(link => {
        var container = link.closest('[jsaction*="mouseover:pane"]');
        var titleText = container ? container.querySelector('.fontHeadlineSmall').textContent : '';
        var rating = '';
        var reviewCount = '';
        var phone = '';
        var industry = '';
        var address = '';
        var companyUrl = '';

        if (container) {
            var roleImgContainer = container.querySelector('[role="img"]');
            
            if (roleImgContainer) {
                var ariaLabel = roleImgContainer.getAttribute('aria-label');
            
                if (ariaLabel && ariaLabel.includes("stars")) {
                    var parts = ariaLabel.split(' ');
                    rating = parts[0];
                    reviewCount = '(' + parts[2] + ')';
                } else {
                    rating = '0';
                    reviewCount = '0';
                }
            }
        }

        if (container) {
            var containerText = container.textContent || '';
            var addressRegex = /\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
            var addressMatch = containerText.match(addressRegex);

            if (addressMatch) {
                address = addressMatch[0];
                var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
                var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
                if (ratingIndex !== -1) {
                    var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/[\r\n]+/)[0];
                    industry = rawIndustryText.replace(/[·.,#!?]/g, '').trim();
                }
                var filterRegex = /\b(Closed|Open 24 hours|24 hours)|Open\b/g;
                address = address.replace(filterRegex, '').trim();
                address = address.replace(/(\d+)(Open)/g, '$1').trim();
                address = address.replace(/(\w)(Open)/g, '$1').trim();
                address = address.replace(/(\w)(Closed)/g, '$1').trim();
            }
        }

        if (container) {
            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            var filteredLinks = allLinks.filter(a => !a.href.startsWith("https://www.google.com/maps/place/"));
            if (filteredLinks.length > 0) {
                companyUrl = filteredLinks[0].href;
            }
        }

        if (container) {
            var containerText = container.textContent || '';
            var phoneRegex = /(\+\d{1,2}\s)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
            var phoneMatch = containerText.match(phoneRegex);
            phone = phoneMatch ? phoneMatch[0] : '';
        }

        return {
            title: titleText,
            rating: rating,
            reviewCount: reviewCount,
            phone: phone,
            industry: industry,
            address: address,
            companyUrl: companyUrl,
            href: link.href,
        };
    });
}

function tableToCsv(table) {
    var csv = [];
    var rows = table.querySelectorAll('tr');
    
    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll('td, th');
        
        for (var j = 0; j < cols.length; j++) {
            row.push('"' + cols[j].innerText + '"');
        }
        csv.push(row.join(','));
    }
    return csv.join('\n');
}

function downloadCsv(csv, filename) {
    var csvFile;
    var downloadLink;

    csvFile = new Blob([csv], {type: 'text/csv'});
    downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
}