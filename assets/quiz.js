/* Quiz widget — reusable across lessons */
/* Usage: add class="quiz" to a div, include data-correct attribute on correct option */

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.quiz').forEach(quiz => {
    const options = quiz.querySelectorAll('.quiz-option');
    const feedback = quiz.querySelector('.quiz-feedback');
    const correctIndex = parseInt(quiz.dataset.correct, 10);
    let answered = false;

    options.forEach((option, index) => {
      option.addEventListener('click', () => {
        if (answered) return;
        answered = true;

        options.forEach(o => o.style.pointerEvents = 'none');

        if (index === correctIndex) {
          option.classList.add('correct');
          feedback.textContent = quiz.dataset.correctText || 'Correct.';
          feedback.className = 'quiz-feedback show correct';
        } else {
          option.classList.add('incorrect');
          options[correctIndex].classList.add('correct');
          feedback.textContent = quiz.dataset.incorrectText || 'Incorrect. The correct answer is highlighted.';
          feedback.className = 'quiz-feedback show incorrect';
        }
      });
    });
  });
});
