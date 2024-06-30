export function getDatesInMonth(year: number, month: number) {
    // Create an empty array to store the dates
    const dates = [];
    
    // Create a new date object for the first day of the given month and year
    const date = new Date(year, month, 1);
    
    // Get the month value to check the end of the loop
    const targetMonth = date.getMonth();
    
    // Loop until the date object's month changes
    while (date.getMonth() === targetMonth) {
        // Add a new date object to the array
        dates.push(new Date(date));
        
        // Increment the date object by one day
        date.setDate(date.getDate() + 1);
    }
    
    return dates;
}